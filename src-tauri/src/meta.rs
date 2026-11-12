//! Online metadata: Steam store batch API (names, art, user tags), Steam news, Epic free games.

use crate::Game;
use reqwest::Client;
use serde::Serialize;
use serde_json::Value;
use std::{collections::HashMap, time::Duration};

pub const META_V: u32 = 3;
const ASSETS: &str = "https://shared.akamai.steamstatic.com/store_item_assets/";

pub fn client() -> Client {
    Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Launcher/0.1")
        .timeout(Duration::from_secs(20))
        .build()
        .expect("http client")
}

async fn get_json(c: &Client, url: &str) -> Option<Value> {
    c.get(url).send().await.ok()?.error_for_status().ok()?.json().await.ok()
}

pub async fn get_bytes(c: &Client, url: &str) -> Option<Vec<u8>> {
    let r = c.get(url).send().await.ok()?.error_for_status().ok()?;
    r.bytes().await.ok().map(|b| b.to_vec())
}

fn norm(s: &str) -> String {
    s.to_lowercase().chars().filter(|c| c.is_alphanumeric()).collect()
}

/// Finds the Steam appid of a game sold elsewhere (to reuse Steam art, tags and news).
pub async fn search_steam(c: &Client, name: &str) -> Option<u32> {
    let clean = name.replace("(Beta)", "").replace("(Demo)", "").replace(['™', '®'], "");
    let r = c
        .get("https://store.steampowered.com/api/storesearch/")
        .query(&[("term", clean.trim()), ("l", "french"), ("cc", "FR")])
        .send().await.ok()?.json::<Value>().await.ok()?;
    let want = norm(&clean);
    r.get("items")?.as_array()?.iter().find_map(|it| {
        let n = norm(it.get("name")?.as_str()?);
        (n == want || (want.len() > 5 && (n.starts_with(&want) || want.starts_with(&n)))).then(|| it.get("id")?.as_u64().map(|x| x as u32)).flatten()
    })
}

pub async fn tag_names(c: &Client) -> HashMap<u64, String> {
    let Some(Value::Array(a)) = get_json(c, "https://store.steampowered.com/tagdata/populartags/french").await else { return HashMap::new() };
    a.iter().filter_map(|t| Some((t.get("tagid")?.as_u64()?, t.get("name")?.as_str()?.to_lowercase()))).collect()
}

/// Steam user tag (lower-case French) → our category label.
fn category(t: &str) -> Option<&'static str> {
    let has = |k: &[&str]| k.iter().any(|x| t.contains(x));
    Some(match () {
        _ if has(&["souls"]) => "Souls-like",
        _ if has(&["rogue"]) => "Roguelite",
        _ if has(&["metroidvania"]) => "Metroidvania",
        _ if has(&["survie"]) && !t.contains("horreur") => "Survie",
        _ if has(&["horreur"]) => "Horreur",
        _ if has(&["coop"]) => "Coop",
        _ if has(&["multijoueur", "jcj", "pvp"]) => "Multijoueur",
        _ if t == "jeu solo" || t == "solo" => "Solo",
        _ if has(&["rpg", "jeu de rôle"]) => "RPG",
        _ if has(&["relaxant", "casual", "cozy", "confortable", "mignon", "détente"]) => "Chill",
        _ if has(&["incrémental", "idle", "clicker"]) => "Incrémental",
        _ if has(&["puzzle", "réflexion", "énigme"]) => "Puzzle",
        _ if has(&["plates-formes", "plateforme"]) => "Plateformes",
        _ if has(&["monde ouvert"]) => "Monde ouvert",
        _ if has(&["construction", "artisanat"]) => "Construction",
        _ if has(&["stratégie"]) => "Stratégie",
        _ if has(&["simulation"]) => "Simulation",
        _ if has(&["fps", "tir"]) => "Tir",
        _ if has(&["course"]) => "Course",
        _ if has(&["rythme", "musique"]) => "Rythme",
        _ if t == "aventure" => "Aventure",
        _ if t == "action" => "Action",
        _ => return None,
    })
}

const SOFT: &[&str] = &["utilitaire", "logiciel", "développement de jeux", "animation", "modélisation", "illustration", "design", "production audio", "vidéo", "photo", "développement web"];

pub struct Info { pub name: String, pub cover: Option<String>, pub hero: Option<String>, pub logo: String, pub tags: Vec<String> }

/// One request for up to 100 apps: name, exact asset URLs, user tags, player categories.
pub async fn steam_batch(c: &Client, ids: &[u32], tags: &HashMap<u64, String>) -> Option<HashMap<u32, Info>> {
    let req = serde_json::json!({
        "ids": ids.iter().map(|i| serde_json::json!({ "appid": i })).collect::<Vec<_>>(),
        "context": { "language": "french", "country_code": "FR" },
        "data_request": { "include_assets": true, "include_basic_info": false, "include_tag_count": 15 }
    });
    let r = c.get("https://api.steampowered.com/IStoreBrowseService/GetItems/v1/")
        .query(&[("input_json", req.to_string())])
        .send().await.ok()?.error_for_status().ok()?.json::<Value>().await.ok()?;
    let mut out = HashMap::new();
    for it in r.pointer("/response/store_items")?.as_array()? {
        if it.get("success").and_then(|v| v.as_u64()) != Some(1) {
            continue;
        }
        let Some(id) = it.get("appid").and_then(|v| v.as_u64()).map(|x| x as u32) else { continue };
        let name = it.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let a = it.get("assets");
        let fmt = a.and_then(|a| a.get("asset_url_format")).and_then(|v| v.as_str()).unwrap_or("");
        let asset = |k: &str| a.and_then(|a| a.get(k)).and_then(|v| v.as_str()).filter(|_| !fmt.is_empty()).map(|f| format!("{ASSETS}{}", fmt.replace("${FILENAME}", f)));
        let cover = asset("library_capsule").or_else(|| asset("header"));
        let hero = asset("library_hero");
        let logo = format!("{ASSETS}steam/apps/{id}/logo.png");
        // categories, ordered by tag weight
        let mut list: Vec<(u64, u64)> = it.get("tags").and_then(|v| v.as_array()).map(|a| a.iter().filter_map(|t| Some((t.get("tagid")?.as_u64()?, t.get("weight")?.as_u64()?))).collect()).unwrap_or_default();
        list.sort_by(|x, y| y.1.cmp(&x.1));
        let names: Vec<&str> = list.iter().filter_map(|(t, _)| tags.get(t).map(|s| s.as_str())).collect();
        let mut cats: Vec<String> = Vec::new();
        if names.iter().take(3).any(|n| SOFT.iter().any(|s| n.contains(s))) {
            cats.push("Logiciel".into());
        } else {
            let pc: Vec<u64> = it.pointer("/categories/supported_player_categoryids").and_then(|v| v.as_array()).map(|a| a.iter().filter_map(|x| x.as_u64()).collect()).unwrap_or_default();
            for n in &names {
                if let Some(cat) = category(n) {
                    if !cats.iter().any(|x| x == cat) {
                        cats.push(cat.into());
                    }
                }
            }
            if pc.iter().any(|x| [1, 36, 49, 47].contains(x)) && !cats.iter().any(|x| x == "Multijoueur") {
                cats.push("Multijoueur".into());
            }
            if pc.iter().any(|x| [9, 38, 48].contains(x)) && !cats.iter().any(|x| x == "Coop") {
                cats.push("Coop".into());
            }
            cats.truncate(6);
        }
        if name.to_lowercase().contains("demo") || name.to_lowercase().contains("démo") {
            cats.insert(0, "Démo".into());
        }
        out.insert(id, Info { name, cover, hero, logo, tags: cats });
    }
    Some(out)
}

pub fn apply(g: &mut Game, i: &Info) {
    if g.name.is_empty() || g.name.starts_with("Jeu Steam ") {
        g.name = i.name.clone();
    }
    // Steam art first (consistent format), Epic art as fallback
    if i.cover.is_some() { g.cover = i.cover.clone(); }
    if i.hero.is_some() { g.hero = i.hero.clone(); }
    if g.logo.is_none() || g.source == "steam" { g.logo = Some(i.logo.clone()); }
    g.tags = i.tags.clone();
}

// ---------- colour ----------

fn rgb_to_hsl(r: f32, g: f32, b: f32) -> (f32, f32, f32) {
    let (mx, mn) = (r.max(g).max(b), r.min(g).min(b));
    let l = (mx + mn) / 2.0;
    if mx == mn {
        return (0.0, 0.0, l);
    }
    let d = mx - mn;
    let s = if l > 0.5 { d / (2.0 - mx - mn) } else { d / (mx + mn) };
    let h = if mx == r { (g - b) / d + if g < b { 6.0 } else { 0.0 } } else if mx == g { (b - r) / d + 2.0 } else { (r - g) / d + 4.0 };
    (h / 6.0, s, l)
}

fn hsl_hex(h: f32, s: f32, l: f32) -> String {
    let f = |n: f32| {
        let k = (n + h * 12.0) % 12.0;
        let a = s * l.min(1.0 - l);
        let v = l - a * (k - 3.0).min(9.0 - k).clamp(-1.0, 1.0);
        (v * 255.0).round() as u8
    };
    format!("#{:02X}{:02X}{:02X}", f(0.0), f(8.0), f(4.0))
}

/// Most vivid dominant colour → (accent for buttons, deep tint for backgrounds).
pub fn accent(bytes: &[u8]) -> Option<(String, String)> {
    let img = image::load_from_memory(bytes).ok()?.thumbnail(48, 72).to_rgb8();
    let mut b = [(0f32, 0f32, 0f32, 0f32); 24];
    for p in img.pixels() {
        let (r, g, bl) = (p[0] as f32 / 255.0, p[1] as f32 / 255.0, p[2] as f32 / 255.0);
        let (h, s, l) = rgb_to_hsl(r, g, bl);
        let w = s * s * (1.0 - (l - 0.55).abs() * 1.6).max(0.0);
        let i = ((h * 24.0) as usize).min(23);
        b[i].0 += w;
        b[i].1 += r * w;
        b[i].2 += g * w;
        b[i].3 += bl * w;
    }
    let best = b.iter().max_by(|x, y| x.0.total_cmp(&y.0))?;
    if best.0 < 0.5 {
        return Some(("#B8C2D6".into(), "#101218".into()));
    }
    let (h, s, _) = rgb_to_hsl(best.1 / best.0, best.2 / best.0, best.3 / best.0);
    Some((hsl_hex(h, s.max(0.72), 0.62), hsl_hex(h, s.min(0.55), 0.10)))
}

// ---------- news ----------

#[derive(Serialize)]
pub struct News { title: String, url: String, date: u64, feed: String, body: String }

fn strip(s: &str) -> String {
    let mut out = String::new();
    let mut depth = 0;
    for c in s.chars() {
        match c {
            '[' | '<' => depth += 1,
            ']' | '>' if depth > 0 => {
                depth -= 1;
                out.push(' ');
            }
            _ if depth == 0 => out.push(c),
            _ => {}
        }
    }
    out.split_whitespace().filter(|w| !w.contains("STEAM_CLAN_IMAGE") && !w.starts_with("http")).collect::<Vec<_>>().join(" ")
}

pub async fn news(c: &Client, appid: u32) -> Vec<News> {
    // official announcements only (third-party feeds are often in other languages)
    let url = format!("https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid={appid}&count=8&maxlength=900&format=json&feeds=steam_community_announcements");
    let Some(j) = get_json(c, &url).await else { return vec![] };
    j.pointer("/appnews/newsitems").and_then(|v| v.as_array()).map(|a| {
        a.iter().map(|n| {
            let s = |k: &str| n.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
            News { title: s("title"), url: s("url"), date: n.get("date").and_then(|v| v.as_u64()).unwrap_or(0), feed: s("feedlabel"), body: strip(&s("contents")) }
        }).collect()
    }).unwrap_or_default()
}

// ---------- free games (Epic) ----------

#[derive(Serialize)]
pub struct Free { title: String, image: String, url: String, until: String, upcoming: bool }

pub async fn epic_free(c: &Client) -> Vec<Free> {
    // the main host is blocked by some DNS filters: fall back to the IPv4 CDN host
    let mut j = None;
    for host in ["store-site-backend-static.epicgames.com", "store-site-backend-static-ipv4.ak.epicgames.com"] {
        j = get_json(c, &format!("https://{host}/freeGamesPromotions?locale=fr&country=FR&allowCountries=FR")).await;
        if j.is_some() {
            break;
        }
    }
    let Some(j) = j else { return vec![] };
    let Some(els) = j.pointer("/data/Catalog/searchStore/elements").and_then(|v| v.as_array()) else { return vec![] };
    let mut out = Vec::new();
    for e in els {
        let free_now = e.pointer("/promotions/promotionalOffers/0/promotionalOffers/0");
        let soon = e.pointer("/promotions/upcomingPromotionalOffers/0/promotionalOffers/0");
        let (offer, upcoming) = match (free_now, soon) {
            (Some(o), _) if e.pointer("/price/totalPrice/discountPrice").and_then(|v| v.as_u64()) == Some(0) => (o, false),
            (None, Some(o)) if o.pointer("/discountSetting/discountPercentage").and_then(|v| v.as_u64()) == Some(0) => (o, true),
            _ => continue,
        };
        let slug = e.pointer("/catalogNs/mappings/0/pageSlug").or_else(|| e.get("productSlug")).and_then(|v| v.as_str()).unwrap_or("").replace("/home", "");
        let image = e.get("keyImages").and_then(|v| v.as_array()).and_then(|imgs| {
            ["OfferImageWide", "DieselStoreFrontWide", "Thumbnail", "OfferImageTall"].iter().find_map(|t| {
                imgs.iter().find(|i| i.get("type").and_then(|x| x.as_str()) == Some(*t)).and_then(|i| i.get("url")?.as_str().map(String::from))
            })
        }).unwrap_or_default();
        let until = offer.get(if upcoming { "startDate" } else { "endDate" }).and_then(|v| v.as_str()).unwrap_or("").to_string();
        out.push(Free {
            title: e.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            image,
            url: if slug.is_empty() { "https://store.epicgames.com/fr/free-games".into() } else { format!("https://store.epicgames.com/fr/p/{slug}") },
            until,
            upcoming,
        });
    }
    out
}
