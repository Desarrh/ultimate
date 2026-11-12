//! Steam friends, wishlist with prices, free-to-keep promos, local screenshots.

use reqwest::Client;
use serde::Serialize;
use serde_json::{json, Value};
use std::{fs, path::PathBuf};

async fn get(c: &Client, url: &str) -> Option<Value> {
    c.get(url).send().await.ok()?.json().await.ok()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Friend { name: String, avatar: String, state: u64, game: Option<String>, appid: Option<u32>, last_off: u64 }

pub async fn friends(c: &Client, key: &str, sid: u64) -> Result<Vec<Friend>, String> {
    let fl = get(c, &format!("https://api.steampowered.com/ISteamUser/GetFriendList/v1/?key={key}&steamid={sid}&relationship=friend")).await
        .ok_or("Liste d'amis inaccessible (profil privé ?)")?;
    let ids: Vec<String> = fl.pointer("/friendslist/friends").and_then(|v| v.as_array()).map(|a| a.iter().filter_map(|f| f.get("steamid")?.as_str().map(String::from)).collect()).unwrap_or_default();
    let mut out = Vec::new();
    for chunk in ids.chunks(100) {
        let Some(s) = get(c, &format!("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key={key}&steamids={}", chunk.join(","))).await else { continue };
        for p in s.pointer("/response/players").and_then(|v| v.as_array()).into_iter().flatten() {
            let st = |k: &str| p.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
            out.push(Friend {
                name: st("personaname"),
                avatar: st("avatarfull"),
                state: p.get("personastate").and_then(|v| v.as_u64()).unwrap_or(0),
                game: p.get("gameextrainfo").and_then(|v| v.as_str()).map(String::from),
                appid: p.get("gameid").and_then(|v| v.as_str()).and_then(|s| s.parse().ok()),
                last_off: p.get("lastlogoff").and_then(|v| v.as_u64()).unwrap_or(0),
            });
        }
    }
    out.sort_by(|a, b| (b.game.is_some(), b.state > 0, b.last_off).cmp(&(a.game.is_some(), a.state > 0, a.last_off)));
    Ok(out)
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Deal { pub appid: u32, pub name: String, pub cover: Option<String>, pub discount: u64, pub price: String, pub original: String }

/// Prices + art for a list of Steam apps.
async fn prices(c: &Client, ids: &[u32]) -> Vec<Deal> {
    let mut out = Vec::new();
    for chunk in ids.chunks(100) {
        let req = json!({
            "ids": chunk.iter().map(|i| json!({ "appid": i })).collect::<Vec<_>>(),
            "context": { "language": "french", "country_code": "FR" },
            "data_request": { "include_assets": true, "include_all_purchase_options": true }
        });
        let Ok(r) = c.get("https://api.steampowered.com/IStoreBrowseService/GetItems/v1/").query(&[("input_json", req.to_string())]).send().await else { continue };
        let Ok(j) = r.json::<Value>().await else { continue };
        for it in j.pointer("/response/store_items").and_then(|v| v.as_array()).into_iter().flatten() {
            let Some(appid) = it.get("appid").and_then(|v| v.as_u64()) else { continue };
            let o = it.get("best_purchase_option");
            let s = |k: &str| o.and_then(|o| o.get(k)).and_then(|v| v.as_str()).unwrap_or("").to_string();
            let fmt = it.pointer("/assets/asset_url_format").and_then(|v| v.as_str()).unwrap_or("");
            // DLC and some games have no vertical capsule: fall back to the wide ones
            let cap = ["library_capsule", "main_capsule", "header", "small_capsule"].iter().find_map(|k| it.pointer(&format!("/assets/{k}")).and_then(|v| v.as_str()));
            out.push(Deal {
                appid: appid as u32,
                name: it.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                cover: cap.filter(|_| !fmt.is_empty()).map(|f| format!("https://shared.akamai.steamstatic.com/store_item_assets/{}", fmt.replace("${FILENAME}", f))),
                discount: o.and_then(|o| o.get("discount_pct")).and_then(|v| v.as_u64()).unwrap_or(0),
                price: { let p = s("formatted_final_price"); if p.is_empty() && it.get("is_free").and_then(|v| v.as_bool()) == Some(true) { "Gratuit".into() } else { p } },
                original: s("formatted_original_price"),
            });
        }
    }
    out
}

pub async fn wishlist(c: &Client, key: &str, sid: u64) -> Result<Vec<Deal>, String> {
    let w = get(c, &format!("https://api.steampowered.com/IWishlistService/GetWishlist/v1/?key={key}&steamid={sid}")).await.ok_or("Liste de souhaits inaccessible")?;
    let ids: Vec<u32> = w.pointer("/response/items").and_then(|v| v.as_array()).map(|a| a.iter().filter_map(|i| i.get("appid")?.as_u64().map(|x| x as u32)).collect()).unwrap_or_default();
    let mut d = prices(c, &ids).await;
    d.sort_by(|a, b| b.discount.cmp(&a.discount).then(a.name.cmp(&b.name)));
    Ok(d)
}

/// Paid Steam games currently free to keep (100 % off).
pub async fn steam_free(c: &Client) -> Vec<Deal> {
    let Some(j) = get(c, "https://store.steampowered.com/search/results/?maxprice=free&specials=1&json=1&cc=FR&l=french").await else { return vec![] };
    let ids: Vec<u32> = j.get("items").and_then(|v| v.as_array()).map(|a| a.iter().filter_map(|i| {
        let logo = i.get("logo")?.as_str()?;
        let id = logo.split("/apps/").nth(1)?.split('/').next()?.parse().ok()?;
        Some(id)
    }).collect()).unwrap_or_default();
    prices(c, &ids).await.into_iter().filter(|d| d.discount == 100).collect()
}

/// Steam screenshots of a game (newest first).
pub fn screenshots(steam_root: Option<PathBuf>, account: Option<u64>, appid: u32) -> Vec<String> {
    let (Some(root), Some(acc)) = (steam_root, account) else { return vec![] };
    let dir = root.join("userdata").join(acc.to_string()).join("760").join("remote").join(appid.to_string()).join("screenshots");
    let Ok(rd) = fs::read_dir(dir) else { return vec![] };
    let mut v: Vec<(std::time::SystemTime, String)> = rd.flatten()
        .filter(|e| e.path().extension().and_then(|x| x.to_str()).map(|x| x.eq_ignore_ascii_case("jpg") || x.eq_ignore_ascii_case("png")).unwrap_or(false))
        .filter_map(|e| Some((e.metadata().ok()?.modified().ok()?, e.path().to_string_lossy().to_string())))
        .collect();
    v.sort_by(|a, b| b.0.cmp(&a.0));
    v.into_iter().take(120).map(|x| x.1).collect()
}

#[derive(Serialize)]
pub struct GogFree { title: String, image: String, url: String }

/// GOG giveaways / games at 100 % off.
pub async fn gog_free(c: &Client) -> Vec<GogFree> {
    let url = "https://catalog.gog.com/v1/catalog?limit=24&price=between:0,0&discounted=eq:true&productType=in:game,pack,dlc&countryCode=FR&locale=fr-FR&currencyCode=EUR";
    let Some(j) = get(c, url).await else { return vec![] };
    j.get("products").and_then(|v| v.as_array()).map(|a| a.iter().filter_map(|p| {
        Some(GogFree {
            title: p.get("title")?.as_str()?.to_string(),
            image: p.get("coverHorizontal").or_else(|| p.get("coverVertical")).and_then(|v| v.as_str()).unwrap_or("").to_string(),
            url: p.get("storeLink").and_then(|v| v.as_str()).unwrap_or("https://www.gog.com/fr/games?priceRange=0,0&discounted=true").to_string(),
        })
    }).collect()).unwrap_or_default()
}
