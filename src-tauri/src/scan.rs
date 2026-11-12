//! Detects installed games from local launcher data (no network).

use crate::{vdf, Game};
use std::{collections::HashMap, fs, path::PathBuf};
use winreg::{enums::*, RegKey};

pub fn scan_all() -> Vec<Game> {
    let mut v = steam();
    v.extend(epic());
    v.extend(gog());
    v
}

// ---------- Steam ----------

const STEAM_SKIP: &[u32] = &[228980, 1070560, 1391110, 1628350, 1493710, 2180100, 1161040, 1826330, 1887720, 2348590, 961940, 1420170];

pub fn steam_root() -> Option<PathBuf> {
    let hk = RegKey::predef(HKEY_CURRENT_USER);
    if let Ok(k) = hk.open_subkey("Software\\Valve\\Steam") {
        if let Ok(p) = k.get_value::<String, _>("SteamPath") {
            let p = PathBuf::from(p.replace('/', "\\"));
            if p.exists() {
                return Some(p);
            }
        }
    }
    let d = PathBuf::from(r"C:\Program Files (x86)\Steam");
    d.exists().then_some(d)
}

/// localconfig.vdf of the most recently active Steam account, with its account id.
fn active_localconfig(root: &PathBuf) -> Option<(u64, PathBuf)> {
    let users = fs::read_dir(root.join("userdata")).ok()?;
    users
        .flatten()
        .filter_map(|u| {
            let id: u64 = u.file_name().to_string_lossy().parse().ok()?;
            let p = u.path().join("config").join("localconfig.vdf");
            let t = fs::metadata(&p).ok()?.modified().ok()?;
            Some((t, id, p))
        })
        .max_by_key(|(t, _, _)| *t)
        .map(|(_, id, p)| (id, p))
}

/// Account id (userdata folder) of the active local account.
pub fn steam_account() -> Option<u64> {
    active_localconfig(&steam_root()?).map(|(id, _)| id)
}

/// SteamID64 of the active local account.
pub fn steam_id() -> Option<u64> {
    let root = steam_root()?;
    active_localconfig(&root).map(|(id, _)| 76561197960265728 + id)
}

/// appid -> (playtime minutes, last played)
fn steam_playtimes(root: &PathBuf) -> HashMap<u32, (u64, u64)> {
    let mut out = HashMap::new();
    let Some((_, path)) = active_localconfig(root) else { return out };
    let Ok(txt) = fs::read_to_string(path) else { return out };
    let root = vdf::parse(&txt);
    if let Some(apps) = root.path(&["UserLocalConfigStore", "Software", "Valve", "Steam", "apps"]) {
        for (id, a) in apps.entries() {
            if let Ok(id) = id.parse::<u32>() {
                out.insert(id, (a.num("Playtime"), a.num("LastPlayed")));
            }
        }
    }
    out
}

fn steam() -> Vec<Game> {
    let Some(root) = steam_root() else { return vec![] };
    let times = steam_playtimes(&root);
    let mut libs = vec![root.clone()];
    if let Ok(txt) = fs::read_to_string(root.join("steamapps").join("libraryfolders.vdf")) {
        let lf = vdf::parse(&txt);
        if let Some(f) = lf.get("libraryfolders") {
            for (_, l) in f.entries() {
                if let Some(p) = l.str("path") {
                    let p = PathBuf::from(p);
                    let key = |x: &PathBuf| x.to_string_lossy().to_lowercase().replace('/', "\\").trim_end_matches('\\').to_string();
                    if !libs.iter().any(|l| key(l) == key(&p)) {
                        libs.push(p);
                    }
                }
            }
        }
    }
    let mut out = Vec::new();
    for lib in libs {
        let apps = lib.join("steamapps");
        let Ok(rd) = fs::read_dir(&apps) else { continue };
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if !(name.starts_with("appmanifest_") && name.ends_with(".acf")) {
                continue;
            }
            let Ok(txt) = fs::read_to_string(e.path()) else { continue };
            let m = vdf::parse(&txt);
            let Some(st) = m.get("AppState") else { continue };
            let id: u32 = st.num("appid") as u32;
            let title = st.str("name").unwrap_or("").to_string();
            if id == 0 || STEAM_SKIP.contains(&id) || title.starts_with("Proton") || title.starts_with("Steam Linux Runtime") || title.starts_with("Steamworks") {
                continue;
            }
            if out.iter().any(|g: &Game| g.steam_appid == Some(id)) {
                continue;
            }
            let (pt, lp) = times.get(&id).copied().unwrap_or((0, 0));
            out.push(Game {
                id: format!("steam:{id}"),
                source: "steam".into(),
                name: title,
                steam_appid: Some(id),
                launch: format!("steam://rungameid/{id}"),
                install_path: st.str("installdir").map(|d| apps.join("common").join(d).to_string_lossy().to_string()),
                playtime_min: pt,
                last_played: lp.max(st.num("LastPlayed")),
                size: st.num("SizeOnDisk"),
                installed: true,
                update: st.num("StateFlags") & 2 != 0 || st.num("BytesToDownload") > st.num("BytesDownloaded"),
                ..Default::default()
            });
        }
    }
    // played but not installed (names come from the store during enrichment)
    for (&id, &(pt, lp)) in &times {
        if pt == 0 || STEAM_SKIP.contains(&id) || out.iter().any(|g| g.steam_appid == Some(id)) {
            continue;
        }
        out.push(Game {
            id: format!("steam:{id}"),
            source: "steam".into(),
            name: format!("Jeu Steam {id}"),
            steam_appid: Some(id),
            launch: format!("steam://rungameid/{id}"),
            playtime_min: pt,
            last_played: lp,
            ..Default::default()
        });
    }
    out
}

// ---------- Epic ----------

fn epic() -> Vec<Game> {
    let base = std::env::var("PROGRAMDATA").unwrap_or_else(|_| r"C:\ProgramData".into());
    let dir = PathBuf::from(&base).join(r"Epic\EpicGamesLauncher\Data\Manifests");
    let mut out: Vec<Game> = Vec::new();
    let Ok(rd) = fs::read_dir(dir) else {
        epic_owned(&base, &mut out);
        return out;
    };
    for e in rd.flatten() {
        if e.path().extension().and_then(|x| x.to_str()) != Some("item") {
            continue;
        }
        let Ok(b) = fs::read(e.path()) else { continue };
        let Ok(j) = serde_json::from_slice::<serde_json::Value>(&b) else { continue };
        let s = |k: &str| j.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
        if j.get("bIsIncompleteInstall").and_then(|v| v.as_bool()).unwrap_or(false) {
            continue;
        }
        if let Some(cats) = j.get("AppCategories").and_then(|v| v.as_array()) {
            if !cats.iter().any(|c| c.as_str() == Some("games")) {
                continue;
            }
        }
        let app = s("AppName");
        if app.is_empty() || out.iter().any(|g| g.id == format!("epic:{app}")) {
            continue;
        }
        out.push(Game {
            id: format!("epic:{app}"),
            source: "epic".into(),
            name: s("DisplayName"),
            launch: format!(
                "com.epicgames.launcher://apps/{}%3A{}%3A{}?action=launch&silent=true",
                s("CatalogNamespace"),
                s("CatalogItemId"),
                app
            ),
            epic_ns: Some(s("CatalogNamespace")),
            epic_app: Some(app.clone()),
            install_path: Some(s("InstallLocation")),
            size: j.get("InstallSize").and_then(|v| v.as_u64()).unwrap_or(0),
            installed: true,
            ..Default::default()
        });
    }
    epic_owned(&base, &mut out);
    out
}

fn epic_img(item: &serde_json::Value, kind: &str, q: &str) -> Option<String> {
    item.get("keyImages")?.as_array()?.iter()
        .find(|i| i.get("type").and_then(|t| t.as_str()) == Some(kind))
        .and_then(|i| i.get("url")?.as_str())
        .map(|u| format!("{u}{q}"))
}

/// Owned library from the launcher's local catalog cache (base64 JSON).
fn epic_owned(base: &str, out: &mut Vec<Game>) {
    use base64::Engine;
    let p = PathBuf::from(base).join(r"Epic\EpicGamesLauncher\Data\Catalog\catcache.bin");
    let Ok(raw) = fs::read(p) else { return };
    let raw: Vec<u8> = raw.into_iter().filter(|b| !b.is_ascii_whitespace()).collect();
    let Ok(dec) = base64::engine::general_purpose::STANDARD.decode(raw) else { return };
    let Ok(serde_json::Value::Array(items)) = serde_json::from_slice::<serde_json::Value>(&dec) else { return };
    let norm = |s: &str| s.to_lowercase().chars().filter(|c| c.is_alphanumeric()).collect::<String>();
    for it in &items {
        let cats: Vec<&str> = it.get("categories").and_then(|c| c.as_array()).map(|a| a.iter().filter_map(|c| c.get("path")?.as_str()).collect()).unwrap_or_default();
        if !cats.contains(&"games") {
            continue;
        }
        let title = it.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let tl = title.to_lowercase();
        if title.is_empty() || tl.contains("test branch") || tl.contains("(beta)") {
            continue;
        }
        let Some(app) = it.pointer("/releaseInfo/0/appId").and_then(|v| v.as_str()) else { continue };
        let ns = it.get("namespace").and_then(|v| v.as_str()).unwrap_or("");
        let cid = it.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let cover = epic_img(it, "DieselGameBoxTall", "?h=480&resize=1&w=360");
        let hero = epic_img(it, "DieselGameBox", "?h=1080&resize=1&w=1920");
        let logo = epic_img(it, "DieselGameBoxLogo", "");
        if let Some(g) = out.iter_mut().find(|g| g.id == format!("epic:{app}")) {
            g.cover = g.cover.take().or(cover);
            g.hero = g.hero.take().or(hero);
            g.logo = g.logo.take().or(logo);
            continue;
        }
        let n = norm(&title);
        if out.iter().any(|g| g.source == "epic" && norm(&g.name) == n) {
            continue;
        }
        out.push(Game {
            id: format!("epic:{app}"),
            source: "epic".into(),
            name: title,
            launch: format!("com.epicgames.launcher://apps/{ns}%3A{cid}%3A{app}?action=launch&silent=true"),
            epic_ns: Some(ns.to_string()),
            epic_app: Some(app.to_string()),
            cover,
            hero,
            logo,
            ..Default::default()
        });
    }
}

// ---------- GOG ----------

fn gog() -> Vec<Game> {
    let hk = RegKey::predef(HKEY_LOCAL_MACHINE);
    let Ok(games) = hk.open_subkey(r"SOFTWARE\WOW6432Node\GOG.com\Games") else { return vec![] };
    let mut out = Vec::new();
    for key in games.enum_keys().flatten() {
        let Ok(k) = games.open_subkey(&key) else { continue };
        let get = |n: &str| k.get_value::<String, _>(n).unwrap_or_default();
        let exe = get("exe");
        if exe.is_empty() {
            continue;
        }
        let id = { let g = get("gameID"); if g.is_empty() { key.clone() } else { g } };
        out.push(Game {
            id: format!("gog:{id}"),
            source: "gog".into(),
            name: get("gameName"),
            launch: exe,
            install_path: Some(get("path")),
            installed: true,
            ..Default::default()
        });
    }
    out
}
