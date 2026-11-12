//! Online metadata: Steam store batch API (names, art, user tags), Steam news, Epic free games.

use crate::Game;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::HashMap, time::Duration};

pub const META_V: u32 = 5;
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
    let items: Vec<(String, String, u32)> = r.get("items")?.as_array()?.iter().filter_map(|it| {
        let name = it.get("name")?.as_str()?.to_string();
        Some((norm(&name), name, it.get("id")?.as_u64()? as u32))
    }).collect();
    best_match(&clean, &items)
}

/// Exact name first; a longer store name only if the extra words are an edition, never a soundtrack/DLC/demo.
pub fn best_match(wanted: &str, items: &[(String, String, u32)]) -> Option<u32> {
    let want = norm(wanted);
    if let Some(x) = items.iter().find(|x| x.0 == want) {
        return Some(x.2);
    }
    const BAD: &[&str] = &["soundtrack", "ost", "dlc", "demo", "playtest", "artbook", "pack", "seasonpass", "expansion", "dedicatedserver", "sdk", "editor", "beta"];
    items.iter().find(|(n, raw, _)| {
        want.len() > 5 && (n.starts_with(&want) || want.starts_with(n.as_str())) && !BAD.iter().any(|b| n.trim_start_matches(&want).contains(b) || is_test_name(raw))
    }).map(|x| x.2)
}

/// Tools that are not games (editors, servers, SDKs…).
pub fn is_tool_name(name: &str) -> bool {
    let n = format!(" {} ", name.to_lowercase());
    [" editor ", " sdk ", " dedicated server ", " server ", " modding tools ", " mod tools ", " toolkit ", " benchmark "].iter().any(|k| n.contains(k))
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
        // Steam store app type: 0 game, 1 demo, 4 DLC, 5 soundtrack, 6 software, 12 playtest…
        match it.get("type").and_then(|v| v.as_u64()).unwrap_or(0) {
            6 => cats = vec!["Logiciel".into()],
            1 | 12 => cats.insert(0, "Démo".into()),
            3..=5 | 7..=11 => cats = vec!["Extra".into()],
            _ if is_tool_name(&name) => cats = vec!["Logiciel".into()],
            _ if is_test_name(&name) => cats.insert(0, "Démo".into()),
            _ => {}
        }
        out.insert(id, Info { name, cover, hero, logo, tags: cats });
    }
    Some(out)
}

/// Demos, playtests and betas are kept apart from real games.
pub fn is_test_name(name: &str) -> bool {
    let n = format!(" {} ", name.to_lowercase().replace(['(', ')', '-', ':', '–'], " "));
    [" demo ", " démo ", " playtest ", " beta ", " bêta ", " test branch ", " pts ", " prologue demo "].iter().any(|k| n.contains(k))
}

/// Name of a delisted Steam app, from its community hub title.
pub async fn community_name(c: &Client, id: u32) -> Option<String> {
    let html = c.get(format!("https://steamcommunity.com/app/{id}")).send().await.ok()?.text().await.ok()?;
    let t = html.split("<title>").nth(1)?.split("</title>").next()?;
    let n = t.split("::").nth(1)?.trim();
    (!n.is_empty() && !n.eq_ignore_ascii_case("Error")).then(|| n.replace("&amp;", "&").replace("&#39;", "'").replace("&quot;", "\""))
}

pub fn apply(g: &mut Game, i: &Info) {
    // a game bought elsewhere that matched a Steam extra (soundtrack, DLC…) is a wrong match
    if g.source != "steam" && i.tags.iter().any(|t| t == "Extra") {
        g.steam_appid = None;
        return;
    }
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

// ---------- store search (manual matching) ----------

#[derive(Serialize)]
pub struct Hit { id: u32, name: String, img: String }

pub async fn steam_search_list(c: &Client, q: &str) -> Vec<Hit> {
    let Ok(r) = c.get("https://store.steampowered.com/api/storesearch/").query(&[("term", q.trim()), ("l", "french"), ("cc", "FR")]).send().await else { return vec![] };
    let Ok(j) = r.json::<Value>().await else { return vec![] };
    j.get("items").and_then(|v| v.as_array()).map(|a| a.iter().take(10).filter_map(|it| Some(Hit {
        id: it.get("id")?.as_u64()? as u32,
        name: it.get("name")?.as_str()?.to_string(),
        img: it.get("tiny_image").and_then(|v| v.as_str()).unwrap_or("").to_string(),
    })).collect()).unwrap_or_default()
}

// ---------- HowLongToBeat ----------

#[derive(Serialize, Deserialize, Clone)]
pub struct Hltb { pub main: f64, pub plus: f64, pub full: f64, pub url: String, pub name: String }

static HLTB_TOKEN: std::sync::Mutex<Option<(String, std::time::Instant)>> = std::sync::Mutex::new(None);

async fn hltb_token(c: &Client, fresh: bool) -> Option<String> {
    if !fresh {
        if let Some((t, at)) = HLTB_TOKEN.lock().unwrap().clone() {
            if at.elapsed() < Duration::from_secs(1800) {
                return Some(t);
            }
        }
    }
    let ts = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).ok()?.as_millis();
    let j: Value = c.get(format!("https://howlongtobeat.com/api/search/site/init?t={ts}")).header("Referer", "https://howlongtobeat.com/").send().await.ok()?.json().await.ok()?;
    let t = j.get("token")?.as_str()?.to_string();
    *HLTB_TOKEN.lock().unwrap() = Some((t.clone(), std::time::Instant::now()));
    Some(t)
}

/// Hours to beat: main story, main + extras, completionist. Ok(None) = game not found.
pub async fn hltb(c: &Client, name: &str) -> Result<Option<Hltb>, String> {
    let clean: String = name.replace(['™', '®', ':', '-', '–'], " ");
    let terms: Vec<&str> = clean.split_whitespace().collect();
    let body = serde_json::json!({
        "searchType": "games", "searchTerms": terms, "searchPage": 1, "size": 8,
        "searchOptions": { "games": { "userId": 0, "platform": "", "sortCategory": "popular", "rangeCategory": "main", "rangeTime": { "min": 0, "max": 0 },
            "gameplay": { "perspective": "", "flow": "", "genre": "" }, "year": "", "modifier": "" },
            "users": { "sortCategory": "postcount" }, "lists": { "sortCategory": "follows" }, "filter": "", "sort": 0, "randomizer": 0 },
        "useCache": true
    });
    let mut tries = 0;
    let j: Value = loop {
        let tok = hltb_token(c, tries > 0).await.ok_or("HowLongToBeat injoignable")?;
        let r = c.post("https://howlongtobeat.com/api/search/site").header("Referer", "https://howlongtobeat.com/").header("Origin", "https://howlongtobeat.com")
            .header("x-auth-token", tok).json(&body).send().await.map_err(|e| e.to_string())?;
        if r.status().as_u16() == 403 && tries == 0 {
            tries += 1;
            continue;
        }
        if r.status().as_u16() == 429 {
            return Err("HowLongToBeat : trop de recherches, réessaie dans une minute".into());
        }
        break r.json().await.map_err(|e| e.to_string())?;
    };
    let want = norm(name);
    let items = j.get("data").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let pick = items.iter().find(|g| g.get("game_name").and_then(|v| v.as_str()).map(norm).as_deref() == Some(want.as_str()))
        .or_else(|| items.iter().find(|g| g.get("game_alias").and_then(|v| v.as_str()).map(|a| a.split(',').any(|x| norm(x) == want)).unwrap_or(false)))
        .or_else(|| items.first().filter(|g| g.get("game_name").and_then(|v| v.as_str()).map(|n| { let n = norm(n); n.starts_with(&want) || want.starts_with(&n) }).unwrap_or(false)));
    Ok(pick.map(|g| {
        let h = |k: &str| (g.get(k).and_then(|v| v.as_f64()).unwrap_or(0.0) / 3600.0 * 10.0).round() / 10.0;
        Hltb {
            main: h("comp_main"),
            plus: h("comp_plus"),
            full: h("comp_100"),
            url: format!("https://howlongtobeat.com/game/{}", g.get("game_id").and_then(|v| v.as_u64()).unwrap_or(0)),
            name: g.get("game_name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        }
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn demo_and_beta_names() {
        for n in ["10 Million Pixels Demo", "The Finals Playtest", "Barony (Beta)", "Crucible Beta", "PSI: Pressure Climbing Demo"] {
            assert!(is_test_name(n), "{n}");
        }
        for n in ["Valheim", "Betrayer", "Demon's Souls", "Alphabeta", "Elden Ring"] {
            assert!(!is_test_name(n), "{n}");
        }
    }
    #[test]
    fn store_name_matching() {
        let items = vec![
            (norm("Supraland Soundtrack"), "Supraland Soundtrack".to_string(), 1),
            (norm("Supraland"), "Supraland".to_string(), 2),
        ];
        assert_eq!(best_match("Supraland", &items), Some(2));
        let only_ost = vec![(norm("Oxenfree Soundtrack"), "Oxenfree Soundtrack".to_string(), 3)];
        assert_eq!(best_match("Oxenfree", &only_ost), None);
        let edition = vec![(norm("Dying Light Definitive Edition"), "Dying Light Definitive Edition".to_string(), 4)];
        assert_eq!(best_match("Dying Light", &edition), Some(4));
        let demo = vec![(norm("Figment Demo"), "Figment Demo".to_string(), 5)];
        assert_eq!(best_match("Figment", &demo), None);
        assert!(is_tool_name("s&box editor") && is_tool_name("ARK Dedicated Server") && !is_tool_name("Serverless Souls"));
    }
    #[test]
    fn categories_map() {
        assert_eq!(category("souls-like"), Some("Souls-like"));
        assert_eq!(category("survie"), Some("Survie"));
        assert_eq!(category("horreur de survie"), Some("Horreur"));
        assert_eq!(category("jeu solo"), Some("Solo"));
        assert_eq!(category("pixel art"), None);
    }
    #[test]
    fn accent_of_a_red_picture_is_red() {
        let img = image::RgbImage::from_pixel(60, 90, image::Rgb([220, 30, 40]));
        let mut buf = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgb8(img).write_to(&mut buf, image::ImageFormat::Png).unwrap();
        let (a, d) = accent(buf.get_ref()).unwrap();
        let r = u8::from_str_radix(&a[1..3], 16).unwrap();
        let g = u8::from_str_radix(&a[3..5], 16).unwrap();
        assert!(r > 180 && g < 120, "{a}");
        assert!(u8::from_str_radix(&d[1..3], 16).unwrap() < 60, "{d}");
    }
    #[test]
    fn strip_news_markup() {
        assert_eq!(strip("[b]Patch[/b] <i>notes</i> {STEAM_CLAN_IMAGE}/x.png https://a.b ok"), "Patch notes ok");
    }
}
