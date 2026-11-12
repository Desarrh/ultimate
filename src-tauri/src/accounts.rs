//! Linked accounts: Steam Web API key, Epic login. Secrets live in the Windows Credential Manager.

use reqwest::Client;
use serde::Serialize;
use serde_json::{json, Value};
use std::{collections::HashMap, sync::Mutex, time::{Duration, Instant}};

const SERVICE: &str = "dev.local.launcher";

/// UI language is French (else English): picks the language of achievement names.
pub static FR: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
fn fr() -> bool { FR.load(std::sync::atomic::Ordering::Relaxed) }
// Public client of the Epic Games Launcher (same flow as open-source launchers like Legendary/Heroic).
const EPIC_ID: &str = "34a02cf8f4414e29b15921876da36f9a";
const EPIC_SECRET: &str = "daafbccc737745039dffe53d94fc76cf";
const EPIC_TOKEN: &str = "https://account-public-service-prod03.ol.epicgames.com/account/api/oauth/token";
pub const EPIC_LOGIN: &str = "https://www.epicgames.com/id/login?redirectUrl=https%3A%2F%2Fwww.epicgames.com%2Fid%2Fapi%2Fredirect%3FclientId%3D34a02cf8f4414e29b15921876da36f9a%26responseType%3Dcode";
const GQL: &str = "https://launcher.store.epicgames.com/graphql";

fn entry(k: &str) -> Option<keyring::Entry> {
    keyring::Entry::new(SERVICE, k).ok()
}
pub fn secret(k: &str) -> Option<String> {
    entry(k)?.get_password().ok().filter(|s| !s.is_empty())
}
pub fn set_secret(k: &str, v: &str) {
    if let Some(e) = entry(k) {
        let _ = if v.is_empty() { e.delete_credential() } else { e.set_password(v) };
    }
}

// ---------- Steam ----------

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Ach {
    pub name: String,
    pub desc: String,
    pub icon: String,
    pub unlocked: bool,
    pub unlock_time: u64,
    pub rarity: Option<f64>,
}

#[derive(Serialize, Clone)]
pub struct AchList {
    pub unlocked: usize,
    pub total: usize,
    pub list: Vec<Ach>,
    /// why the list is empty / partial
    pub note: Option<String>,
}

async fn json_get(c: &Client, url: &str) -> Option<Value> {
    c.get(url).send().await.ok()?.json().await.ok()
}

/// Owned games with real playtime (includes never-played ones). appid -> (name, minutes, last played)
pub async fn steam_owned(c: &Client, key: &str, sid: u64) -> Option<HashMap<u32, (String, u64, u64, u64)>> {
    let url = format!("https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key={key}&steamid={sid}&include_appinfo=1&include_played_free_games=1&format=json");
    let j = json_get(c, &url).await?;
    let games = j.pointer("/response/games")?.as_array()?;
    Some(games.iter().filter_map(|g| {
        Some((g.get("appid")?.as_u64()? as u32, (
            g.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            g.get("playtime_forever").and_then(|v| v.as_u64()).unwrap_or(0),
            g.get("rtime_last_played").and_then(|v| v.as_u64()).unwrap_or(0),
            g.get("playtime_2weeks").and_then(|v| v.as_u64()).unwrap_or(0),
        )))
    }).collect())
}

pub async fn steam_achievements(c: &Client, key: &str, sid: u64, appid: u32) -> AchList {
    let empty = |n: &str| AchList { unlocked: 0, total: 0, list: vec![], note: Some(n.into()) };
    let schema = json_get(c, &format!("https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/?key={key}&appid={appid}&l={}", if fr() { "french" } else { "english" })).await;
    let defs = schema.as_ref().and_then(|s| s.pointer("/game/availableGameStats/achievements")).and_then(|v| v.as_array()).cloned().unwrap_or_default();
    if defs.is_empty() {
        return empty("Aucun succès.");
    }
    let player = json_get(c, &format!("https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/?key={key}&steamid={sid}&appid={appid}")).await;
    let mine: HashMap<String, (bool, u64)> = player.as_ref()
        .and_then(|p| p.pointer("/playerstats/achievements")).and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|x| Some((x.get("apiname")?.as_str()?.to_string(), (x.get("achieved")?.as_u64()? == 1, x.get("unlocktime").and_then(|v| v.as_u64()).unwrap_or(0))))).collect())
        .unwrap_or_default();
    let private = player.as_ref().and_then(|p| p.pointer("/playerstats/success")).and_then(|v| v.as_bool()) == Some(false);
    let rare: HashMap<String, f64> = json_get(c, &format!("https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid={appid}")).await
        .and_then(|j| j.pointer("/achievementpercentages/achievements").and_then(|v| v.as_array()).cloned())
        .map(|a| a.iter().filter_map(|x| Some((x.get("name")?.as_str()?.to_string(), x.get("percent").and_then(|p| p.as_f64().or_else(|| p.as_str()?.parse().ok()))?))).collect())
        .unwrap_or_default();
    let list: Vec<Ach> = defs.iter().filter_map(|d| {
        let api = d.get("name")?.as_str()?.to_string();
        let (unlocked, t) = mine.get(&api).copied().unwrap_or((false, 0));
        let hidden = d.get("hidden").and_then(|v| v.as_u64()) == Some(1);
        let s = |k: &str| d.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
        Some(Ach {
            name: s("displayName"),
            desc: if hidden && !unlocked { "Succès caché".into() } else { s("description") },
            // the old akamai host is dead for some apps: use the current Steam CDN
            icon: (if unlocked { s("icon") } else { s("icongray") }).replace("steamcdn-a.akamaihd.net", "cdn.fastly.steamstatic.com"),
            unlocked,
            unlock_time: t,
            rarity: rare.get(&api).copied(),
        })
    }).collect();
    let unlocked = list.iter().filter(|a| a.unlocked).count();
    AchList {
        unlocked,
        total: list.len(),
        list,
        note: private.then(|| "Profil Steam privé (Détails de jeu → Public).".into()),
    }
}

// ---------- Epic ----------

struct EpicSession { access: String, account: String, until: Instant }
static EPIC: Mutex<Option<EpicSession>> = Mutex::new(None);

async fn epic_token(c: &Client, form: &[(&str, &str)]) -> Result<String, String> {
    let r = c.post(EPIC_TOKEN).basic_auth(EPIC_ID, Some(EPIC_SECRET)).form(form).send().await.map_err(|e| e.to_string())?;
    let j: Value = r.json().await.map_err(|e| e.to_string())?;
    let s = |k: &str| j.get(k).and_then(|v| v.as_str()).map(String::from);
    let access = s("access_token").ok_or_else(|| s("errorMessage").unwrap_or_else(|| "Connexion Epic refusée".into()))?;
    let refresh = s("refresh_token").unwrap_or_default();
    let account = s("account_id").unwrap_or_default();
    let name = s("displayName").unwrap_or_default();
    set_secret("epic_refresh", &refresh);
    set_secret("epic_account", &account);
    set_secret("epic_name", &name);
    let secs = j.get("expires_in").and_then(|v| v.as_u64()).unwrap_or(7200);
    *EPIC.lock().unwrap() = Some(EpicSession { access, account, until: Instant::now() + Duration::from_secs(secs.saturating_sub(120)) });
    Ok(name)
}

/// Accepts the bare code or the whole JSON page the user copied.
pub fn auth_code(input: &str) -> Option<String> {
    let code = match serde_json::from_str::<Value>(input.trim()) {
        Ok(Value::String(s)) => s,
        Ok(j) => j.get("authorizationCode").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        Err(_) => input.trim().trim_matches('"').to_string(),
    };
    (code.len() >= 16 && code.chars().all(|c| c.is_ascii_alphanumeric())).then_some(code)
}

pub async fn epic_connect(c: &Client, input: &str) -> Result<String, String> {
    let code = auth_code(input).ok_or("Code invalide : copie la valeur « authorizationCode ».")?;
    epic_token(c, &[("grant_type", "authorization_code"), ("code", &code), ("token_type", "eg1")]).await
}

pub fn epic_disconnect() {
    for k in ["epic_refresh", "epic_account", "epic_name"] {
        set_secret(k, "");
    }
    *EPIC.lock().unwrap() = None;
}

async fn epic_session(c: &Client) -> Option<(String, String)> {
    {
        let g = EPIC.lock().unwrap();
        if let Some(s) = g.as_ref().filter(|s| s.until > Instant::now()) {
            return Some((s.access.clone(), s.account.clone()));
        }
    }
    let rt = secret("epic_refresh")?;
    epic_token(c, &[("grant_type", "refresh_token"), ("refresh_token", &rt), ("token_type", "eg1")]).await.ok()?;
    let g = EPIC.lock().unwrap();
    g.as_ref().map(|s| (s.access.clone(), s.account.clone()))
}

/// AppName -> minutes
pub async fn epic_playtime(c: &Client) -> Option<HashMap<String, u64>> {
    let (tok, acc) = epic_session(c).await?;
    let url = format!("https://library-service.live.use1a.on.epicgames.com/library/api/public/playtime/account/{acc}/all");
    let j: Value = c.get(url).bearer_auth(tok).send().await.ok()?.json().await.ok()?;
    Some(j.as_array()?.iter().filter_map(|x| Some((x.get("artifactId")?.as_str()?.to_string(), x.get("totalTime")?.as_u64()? / 60))).collect())
}

async fn gql(c: &Client, q: &str, vars: Value, tok: Option<&str>) -> Option<Value> {
    let mut r = c.post(GQL).header("User-Agent", "EpicGamesLauncher/17.0").json(&json!({ "query": q, "variables": vars }));
    if let Some(t) = tok {
        r = r.bearer_auth(t);
    }
    r.send().await.ok()?.json().await.ok()
}

pub async fn epic_achievements(c: &Client, ns: &str) -> AchList {
    const DEFS: &str = "query($sandboxId:String!,$locale:String!){Achievement{productAchievementsRecordBySandbox(sandboxId:$sandboxId,locale:$locale){totalAchievements achievements{achievement{name hidden unlockedDisplayName lockedDisplayName unlockedDescription lockedDescription unlockedIconLink lockedIconLink rarity{percent}}}}}}";
    const MINE: &str = "query($epicAccountId:String!,$sandboxId:String!){PlayerAchievement{playerAchievementGameRecordsBySandbox(epicAccountId:$epicAccountId,sandboxId:$sandboxId){records{totalUnlocked playerAchievements{playerAchievement{achievementName unlocked unlockDate}}}}}}";
    let defs = gql(c, DEFS, json!({ "sandboxId": ns, "locale": if fr() { "fr" } else { "en" } }), None).await;
    let items = defs.as_ref().and_then(|d| d.pointer("/data/Achievement/productAchievementsRecordBySandbox/achievements")).and_then(|v| v.as_array()).cloned().unwrap_or_default();
    if items.is_empty() {
        return AchList { unlocked: 0, total: 0, list: vec![], note: Some("Aucun succès.".into()) };
    }
    let mut note = None;
    let mut mine: HashMap<String, u64> = HashMap::new();
    match epic_session(c).await {
        Some((tok, acc)) => {
            let r = gql(c, MINE, json!({ "epicAccountId": acc, "sandboxId": ns }), Some(&tok)).await;
            if let Some(recs) = r.as_ref().and_then(|r| r.pointer("/data/PlayerAchievement/playerAchievementGameRecordsBySandbox/records")).and_then(|v| v.as_array()) {
                for rec in recs {
                    for pa in rec.get("playerAchievements").and_then(|v| v.as_array()).into_iter().flatten() {
                        let p = pa.get("playerAchievement").unwrap_or(pa);
                        if p.get("unlocked").and_then(|v| v.as_bool()) == Some(true) {
                            let t = p.get("unlockDate").and_then(|v| v.as_str()).map(iso_to_unix).unwrap_or(0);
                            if let Some(n) = p.get("achievementName").and_then(|v| v.as_str()) {
                                mine.insert(n.to_string(), t);
                            }
                        }
                    }
                }
            }
        }
        None => note = Some("Connecte Epic (Paramètres).".into()),
    }
    let list: Vec<Ach> = items.iter().filter_map(|it| {
        let a = it.get("achievement")?;
        let s = |k: &str| a.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
        let id = s("name");
        let unlocked = mine.contains_key(&id);
        let hidden = a.get("hidden").and_then(|v| v.as_bool()).unwrap_or(false);
        Some(Ach {
            name: if unlocked || !hidden { s("unlockedDisplayName") } else { s("lockedDisplayName") },
            desc: if unlocked { s("unlockedDescription") } else if hidden { "Succès caché".into() } else { s("lockedDescription") },
            icon: if unlocked { s("unlockedIconLink") } else { s("lockedIconLink") },
            unlocked,
            unlock_time: mine.get(&id).copied().unwrap_or(0),
            rarity: a.pointer("/rarity/percent").and_then(|v| v.as_f64()),
        })
    }).collect();
    let unlocked = list.iter().filter(|a| a.unlocked).count();
    AchList { unlocked, total: list.len(), list, note }
}

/// "2024-03-14T16:04:09.948Z" -> unix seconds (UTC)
fn iso_to_unix(s: &str) -> u64 {
    let n = |a: usize, b: usize| s.get(a..b).and_then(|x| x.parse::<i64>().ok()).unwrap_or(0);
    let (y, m, d) = (n(0, 4), n(5, 7), n(8, 10));
    if y == 0 {
        return 0;
    }
    let (y2, m2) = if m <= 2 { (y - 1, m + 9) } else { (y, m - 3) };
    let days = 365 * y2 + y2 / 4 - y2 / 100 + y2 / 400 + (153 * m2 + 2) / 5 + d - 719469;
    (days * 86400 + n(11, 13) * 3600 + n(14, 16) * 60 + n(17, 19)).max(0) as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn iso_dates() {
        assert_eq!(iso_to_unix("1970-01-01T00:00:00.000Z"), 0);
        assert_eq!(iso_to_unix("2024-03-14T16:04:09.948Z"), 1710432249);
        assert_eq!(iso_to_unix(""), 0);
    }
    #[test]
    fn epic_code_from_page_or_bare() {
        let json = r#"{"redirectUrl":"https://x","authorizationCode":"0123456789abcdef0123456789abcdef","sid":null}"#;
        assert_eq!(auth_code(json).as_deref(), Some("0123456789abcdef0123456789abcdef"));
        assert_eq!(auth_code("  \"0123456789abcdef0123456789abcdef\" ").as_deref(), Some("0123456789abcdef0123456789abcdef"));
        assert_eq!(auth_code("trop court"), None);
        assert_eq!(auth_code(r#"{"authorizationCode":null}"#), None);
    }
}
