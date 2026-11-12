mod accounts;
mod extra;
mod img;
mod saves;
mod meta;
mod scan;
mod vdf;

use futures::StreamExt;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::{collections::{HashMap, HashSet}, fs, os::windows::process::CommandExt, path::PathBuf, sync::Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Game {
    pub id: String,
    pub source: String,
    pub name: String,
    pub steam_appid: Option<u32>,
    pub launch: String,
    pub install_path: Option<String>,
    pub playtime_min: u64,
    pub last_played: u64,
    pub size: u64,
    pub cover: Option<String>,
    pub hero: Option<String>,
    pub logo: Option<String>,
    pub accent: Option<String>,
    pub deep: Option<String>,
    pub tags: Vec<String>,
    pub enriched: bool,
    pub meta_v: u32,
    pub installed: bool,
    pub epic_ns: Option<String>,
    pub epic_app: Option<String>,
    /// minutes measured by this app (games outside Steam)
    pub tracked_min: u64,
    /// Steam: an update is waiting
    pub update: bool,
    /// minutes played in the last two weeks (Steam)
    pub recent_min: u64,
}

pub struct AppState {
    lib: Mutex<Vec<Game>>,
    memos: Mutex<HashMap<String, String>>,
    dir: PathBuf,
    busy: Mutex<bool>,
    ach_busy: Mutex<bool>,
    http: reqwest::Client,
    /// minutes this app measured per game
    tracked: Mutex<HashMap<String, u64>>,
    tracking: Mutex<HashSet<String>>,
    /// achievement summary per game: [unlocked, total]
    achsum: Mutex<HashMap<String, [usize; 2]>>,
}

fn load<T: DeserializeOwned + Default>(p: &PathBuf) -> T {
    fs::read(p).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

fn save<T: Serialize>(p: &PathBuf, v: &T) {
    if let Ok(b) = serde_json::to_vec(v) {
        let tmp = p.with_extension("tmp");
        if fs::write(&tmp, b).is_ok() {
            let _ = fs::rename(tmp, p);
        }
    }
}

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn open_target(t: &str) -> Result<(), String> {
    let ext = PathBuf::from(t).extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    if t.contains("://") || (!t.contains("://") && ["lnk", "url", "bat"].contains(&ext.as_str())) {
        std::process::Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", t])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    } else {
        let p = PathBuf::from(t);
        let mut cmd = std::process::Command::new(&p);
        if let Some(dir) = p.parent() {
            cmd.current_dir(dir);
        }
        cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn get_cached(st: State<AppState>) -> Vec<Game> {
    st.lib.lock().unwrap().clone()
}

fn keep_meta(g: &mut Game, o: &Game) {
    if o.enriched && o.meta_v == meta::META_V && (g.source != "pc" || g.steam_appid == o.steam_appid) {
        g.meta_v = o.meta_v;
        g.steam_appid = g.steam_appid.or(o.steam_appid);
        if !o.name.is_empty() && g.name.starts_with("Jeu Steam ") {
            g.name = o.name.clone();
        }
        g.cover = o.cover.clone().or(g.cover.take());
        g.hero = o.hero.clone().or(g.hero.take());
        g.logo = o.logo.clone().or(g.logo.take());
        g.accent = o.accent.clone();
        g.deep = o.deep.clone();
        g.tags = o.tags.clone();
        g.enriched = true;
    }
}

#[tauri::command]
async fn refresh(app: AppHandle, force: Option<bool>) -> Result<usize, String> {
    let st = app.state::<AppState>();
    {
        let mut b = st.busy.lock().unwrap();
        if *b {
            return Ok(0);
        }
        *b = true;
    }
    let res = do_refresh(&app, force.unwrap_or(false)).await;
    *st.busy.lock().unwrap() = false;
    res
}

async fn do_refresh(app: &AppHandle, force: bool) -> Result<usize, String> {
    let st = app.state::<AppState>();
    let http = st.http.clone();
    let mut scanned = tauri::async_runtime::spawn_blocking(scan::scan_all).await.map_err(|e| e.to_string())?;
    scanned.extend(custom_games(&st));

    // Steam Web API (if a key is set): every owned game + exact playtime
    if let (Some(key), Some(sid)) = (accounts::secret("steam_key"), scan::steam_id()) {
        if let Some(owned) = accounts::steam_owned(&http, &key, sid).await {
            for (id, (name, pt, lp, rc)) in owned {
                match scanned.iter_mut().find(|g| g.steam_appid == Some(id)) {
                    Some(g) => {
                        if g.name.starts_with("Jeu Steam ") && !name.is_empty() {
                            g.name = name.clone();
                        }
                        g.playtime_min = g.playtime_min.max(pt);
                        g.last_played = g.last_played.max(lp);
                        g.recent_min = rc;
                    }
                    None => scanned.push(Game {
                        id: format!("steam:{id}"),
                        source: "steam".into(),
                        name,
                        steam_appid: Some(id),
                        launch: format!("steam://rungameid/{id}"),
                        playtime_min: pt,
                        last_played: lp,
                        recent_min: rc,
                        ..Default::default()
                    }),
                }
            }
        }
    }
    {
        let old = st.lib.lock().unwrap();
        let by: HashMap<&str, &Game> = old.iter().map(|g| (g.id.as_str(), g)).collect();
        for g in scanned.iter_mut() {
            if let Some(o) = by.get(g.id.as_str()) {
                if !force {
                    keep_meta(g, o);
                }
                g.last_played = g.last_played.max(o.last_played);
            }
        }
    }
    // two Steam apps with the same name: the one without a store page is a companion app (tool, server, test build)
    {
        let key = |n: &str| n.to_lowercase().chars().filter(|c| c.is_alphanumeric()).collect::<String>();
        let mut groups: HashMap<String, Vec<usize>> = HashMap::new();
        for (i, g) in scanned.iter().enumerate().filter(|(_, g)| g.source == "steam" && !g.name.starts_with("Jeu Steam ")) {
            groups.entry(key(&g.name)).or_default().push(i);
        }
        for idx in groups.values().filter(|v| v.len() > 1) {
            let main = *idx.iter().max_by_key(|&&i| (scanned[i].cover.is_some(), scanned[i].tags.len(), scanned[i].playtime_min)).unwrap();
            let extras: Vec<usize> = idx.iter().copied().filter(|&i| i != main && scanned[i].cover.is_none()).collect();
            for i in extras {
                scanned[i].tags = vec!["Extra".into()];
            }
        }
    }
    // Valve's Steamworks test app (used by GodotSteam and dev builds): not a real game
    for g in scanned.iter_mut().filter(|g| g.steam_appid == Some(480)) {
        g.name = "Spacewar (test Steamworks)".into();
        g.tags = vec!["Logiciel".into()];
    }
    // playtime outside Steam: Epic's own counter (if connected), else what this app measured
    let epic_pt = accounts::epic_playtime(&http).await.unwrap_or_default();
    {
        let tracked = st.tracked.lock().unwrap();
        for g in scanned.iter_mut().filter(|g| g.source != "steam") {
            g.tracked_min = tracked.get(&g.id).copied().unwrap_or(0);
            let api = g.epic_app.as_ref().and_then(|a| epic_pt.get(a)).copied().unwrap_or(0);
            g.playtime_min = api.max(g.tracked_min);
        }
    }
    *st.lib.lock().unwrap() = scanned.clone();
    save(&st.dir.join("library.json"), &scanned);
    let _ = app.emit("library", &scanned);
    snapshot(&st);

    let n = scanned.iter().filter(|g| !g.enriched).count();
    if n == 0 {
        return Ok(0);
    }
    let emit = |app: &AppHandle| {
        let l = app.state::<AppState>().lib.lock().unwrap().clone();
        let _ = app.emit("library", &l);
    };

    // 1. games from other stores → matching Steam appid
    let search: Vec<(String, String)> = scanned.iter().filter(|g| !g.enriched && g.steam_appid.is_none()).map(|g| (g.id.clone(), g.name.clone())).collect();
    let mut s = futures::stream::iter(search.into_iter().map(|(id, name)| {
        let c = http.clone();
        async move { (id, meta::search_steam(&c, &name).await) }
    }))
    .buffer_unordered(6);
    let mut found: HashMap<String, u32> = HashMap::new();
    while let Some((id, r)) = s.next().await {
        if let Some(a) = r {
            found.insert(id, a);
        }
    }
    drop(s);

    // 2. names, art, categories: one request per 100 apps
    let tags = meta::tag_names(&http).await;
    let ids: Vec<u32> = {
        let mut lib = st.lib.lock().unwrap();
        for g in lib.iter_mut() {
            if let Some(a) = found.get(&g.id) {
                g.steam_appid = Some(*a);
            }
        }
        let mut v: Vec<u32> = lib.iter().filter(|g| !g.enriched).filter_map(|g| g.steam_appid).collect();
        v.sort_unstable();
        v.dedup();
        v
    };
    let mut infos = HashMap::new();
    let mut ok = true;
    for chunk in ids.chunks(100) {
        match meta::steam_batch(&http, chunk, &tags).await {
            Some(m) => infos.extend(m),
            None => ok = false,
        }
    }
    {
        let mut lib = st.lib.lock().unwrap();
        for g in lib.iter_mut().filter(|g| !g.enriched) {
            if let Some(i) = g.steam_appid.and_then(|a| infos.get(&a)) {
                meta::apply(g, i);
            }
        }
    }
    emit(app);

    // 2b. still unnamed (delisted apps, playtests): ask the community hub
    let unnamed: Vec<(String, u32)> = st.lib.lock().unwrap().iter().filter(|g| g.name.starts_with("Jeu Steam ")).filter_map(|g| Some((g.id.clone(), g.steam_appid?))).collect();
    let mut s = futures::stream::iter(unnamed.into_iter().map(|(id, a)| {
        let c = http.clone();
        async move { (id, meta::community_name(&c, a).await) }
    }))
    .buffer_unordered(4);
    while let Some((id, n)) = s.next().await {
        if let Some(n) = n {
            if let Some(g) = st.lib.lock().unwrap().iter_mut().find(|g| g.id == id) {
                if meta::is_test_name(&n) && !g.tags.iter().any(|t| t == "Démo") {
                    g.tags.insert(0, "Démo".into());
                }
                g.name = n;
            }
        }
    }
    drop(s);
    // no store page and no community name: delisted app or private playtest
    for g in st.lib.lock().unwrap().iter_mut().filter(|g| g.name.starts_with("Jeu Steam ") && !g.tags.iter().any(|t| t == "Démo")) {
        g.tags = vec!["Démo".into()];
    }
    // tools by name (editors, servers…)
    for g in st.lib.lock().unwrap().iter_mut().filter(|g| !g.enriched && meta::is_tool_name(&g.name)) {
        g.tags = vec!["Logiciel".into()];
    }
    // Epic / GOG: demos and betas by name
    for g in st.lib.lock().unwrap().iter_mut().filter(|g| !g.enriched && meta::is_test_name(&g.name) && !g.tags.iter().any(|t| t == "Démo")) {
        g.tags.insert(0, "Démo".into());
    }

    // 3. accent colour from each cover
    let covers: Vec<(String, String)> = st.lib.lock().unwrap().iter().filter(|g| !g.enriched).filter_map(|g| Some((g.id.clone(), g.cover.clone()?))).collect();
    let mut s = futures::stream::iter(covers.into_iter().map(|(id, url)| {
        let c = http.clone();
        async move {
            let acc = match meta::get_bytes(&c, &url).await {
                Some(b) => tauri::async_runtime::spawn_blocking(move || meta::accent(&b)).await.ok().flatten(),
                None => None,
            };
            (id, acc)
        }
    }))
    .buffer_unordered(8);
    let mut k = 0;
    while let Some((id, acc)) = s.next().await {
        if let Some((a, d)) = acc {
            if let Some(g) = st.lib.lock().unwrap().iter_mut().find(|g| g.id == id) {
                g.accent = Some(a);
                g.deep = Some(d);
            }
        }
        k += 1;
        if k % 40 == 0 {
            emit(app);
        }
    }
    drop(s);

    if ok {
        for g in st.lib.lock().unwrap().iter_mut() {
            g.enriched = true;
            g.meta_v = meta::META_V;
        }
    }
    emit(app);
    let l = st.lib.lock().unwrap().clone();
    save(&st.dir.join("library.json"), &l);
    Ok(n)
}

#[tauri::command]
fn launch(app: AppHandle, id: String) -> Result<(), String> {
    let st = app.state::<AppState>();
    let g = st.lib.lock().unwrap().iter().find(|g| g.id == id).cloned().ok_or("Jeu introuvable")?;
    open_target(&g.launch)?;
    // hand-added games are measured by watch_pc (also when started outside Ultimate)
    if let Some(dir) = g.install_path.filter(|_| g.installed && g.source != "pc") {
        if st.tracking.lock().unwrap().insert(id.clone()) {
            track(app.clone(), id, dir);
        }
    }
    Ok(())
}

/// Playtime of hand-added games: every 20 s, is their .exe running? Counts from start to exit,
/// however the game was launched.
fn watch_pc(app: AppHandle) {
    std::thread::spawn(move || {
        use std::time::{Duration, Instant};
        use sysinfo::{ProcessesToUpdate, System};
        let mut sys = System::new();
        let mut running: HashMap<String, Instant> = HashMap::new();
        loop {
            std::thread::sleep(Duration::from_secs(20));
            let st = app.state::<AppState>();
            let games: Vec<(String, String)> = customs(&st).into_iter()
                .filter(|c| c.exe.to_lowercase().ends_with(".exe"))
                .map(|c| (c.id, c.exe.to_lowercase())).collect();
            if games.is_empty() && running.is_empty() {
                continue;
            }
            sys.refresh_processes(ProcessesToUpdate::All, true);
            let live: HashSet<String> = sys.processes().values().filter_map(|p| p.exe()).map(|e| e.to_string_lossy().to_lowercase()).collect();
            let mut changed = false;
            for (id, exe) in &games {
                let on = live.contains(exe);
                match (on, running.get(id).copied()) {
                    (true, None) => {
                        running.insert(id.clone(), Instant::now());
                        if let Some(g) = st.lib.lock().unwrap().iter_mut().find(|g| &g.id == id) {
                            g.last_played = now();
                        }
                        changed = true;
                    }
                    (false, Some(start)) => {
                        running.remove(id);
                        let mins = (start.elapsed().as_secs() + 30) / 60;
                        if mins > 0 {
                            let mut t = st.tracked.lock().unwrap();
                            *t.entry(id.clone()).or_insert(0) += mins;
                            save(&st.dir.join("tracked.json"), &*t);
                        }
                        if let Some(g) = st.lib.lock().unwrap().iter_mut().find(|g| &g.id == id) {
                            g.tracked_min += mins;
                            g.playtime_min += mins;
                            g.last_played = now();
                        }
                        changed = true;
                    }
                    _ => {}
                }
            }
            if changed {
                let l = st.lib.lock().unwrap().clone();
                save(&st.dir.join("library.json"), &l);
                let _ = app.emit("library", &l);
            }
        }
    });
}

fn now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// Measures a session by watching for a running process inside the game's folder.
fn track(app: AppHandle, id: String, dir: String) {
    std::thread::spawn(move || {
        use std::time::{Duration, Instant};
        use sysinfo::{ProcessesToUpdate, System};
        let dir = dir.to_lowercase();
        let mut sys = System::new();
        let mut running = || {
            sys.refresh_processes(ProcessesToUpdate::All, true);
            sys.processes().values().any(|p| p.exe().map(|e| e.to_string_lossy().to_lowercase().starts_with(&dir)).unwrap_or(false))
        };
        let st = app.state::<AppState>();
        let mut waited = 0;
        while !running() {
            std::thread::sleep(Duration::from_secs(5));
            waited += 5;
            if waited > 240 {
                st.tracking.lock().unwrap().remove(&id);
                return;
            }
        }
        let start = Instant::now();
        while running() {
            std::thread::sleep(Duration::from_secs(15));
        }
        let mins = (start.elapsed().as_secs() + 30) / 60;
        st.tracking.lock().unwrap().remove(&id);
        {
            let mut t = st.tracked.lock().unwrap();
            *t.entry(id.clone()).or_insert(0) += mins;
            save(&st.dir.join("tracked.json"), &*t);
        }
        let l = {
            let mut lib = st.lib.lock().unwrap();
            if let Some(g) = lib.iter_mut().find(|g| g.id == id) {
                g.last_played = now();
                if g.source != "steam" {
                    g.tracked_min += mins;
                    g.playtime_min += mins;
                }
            }
            lib.clone()
        };
        save(&st.dir.join("library.json"), &l);
        let _ = app.emit("library", &l);
        if mins > 0 && user(&st).auto_backup {
            if let Some(g) = l.iter().find(|g| g.id == id).cloned() {
                let app2 = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Ok((n, _)) = backup_game(&app2, &g).await {
                        let fr = user(&app2.state::<AppState>()).lang == "fr";
                        notify(&app2, &g.name, &if fr { format!("Sauvegarde : {n} fichier(s)") } else { format!("Backup: {n} file(s)") });
                    }
                });
            }
        }
    });
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Accounts {
    steam_key: bool,
    steam_id: Option<String>,
    epic: Option<String>,
}

#[tauri::command]
fn accounts_status() -> Accounts {
    Accounts {
        steam_key: accounts::secret("steam_key").is_some(),
        steam_id: scan::steam_id().map(|i| i.to_string()),
        epic: accounts::secret("epic_refresh").map(|_| accounts::secret("epic_name").unwrap_or_else(|| "Compte Epic".into())),
    }
}

#[tauri::command]
async fn set_steam_key(app: AppHandle, key: String) -> Result<(), String> {
    let key = key.trim().to_string();
    if key.is_empty() {
        accounts::set_secret("steam_key", "");
        return Ok(());
    }
    if key.len() != 32 || !key.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("Une clé Steam fait 32 caractères (chiffres et lettres A-F).".into());
    }
    let sid = scan::steam_id().ok_or("Compte Steam local introuvable")?;
    let http = app.state::<AppState>().http.clone();
    accounts::steam_owned(&http, &key, sid).await.ok_or("Steam refuse cette clé, ou ton profil est privé.")?;
    accounts::set_secret("steam_key", &key);
    Ok(())
}

#[tauri::command]
fn epic_login() -> Result<(), String> {
    open_target(accounts::EPIC_LOGIN)
}

#[tauri::command]
async fn epic_connect(app: AppHandle, code: String) -> Result<String, String> {
    let http = app.state::<AppState>().http.clone();
    accounts::epic_connect(&http, &code).await
}

#[tauri::command]
fn epic_disconnect() {
    accounts::epic_disconnect();
}

#[tauri::command]
fn get_achsum(st: State<AppState>) -> HashMap<String, [usize; 2]> {
    st.achsum.lock().unwrap().clone()
}

async fn game_achievements(http: &reqwest::Client, g: &Game) -> accounts::AchList {
    let none = |n: &str| accounts::AchList { unlocked: 0, total: 0, list: vec![], note: Some(n.into()) };
    if let Some(ns) = g.epic_ns.as_ref().filter(|_| g.source == "epic") {
        return accounts::epic_achievements(http, ns).await;
    }
    if g.source != "steam" {
        return none("Aucun succès.");
    }
    match (g.steam_appid, accounts::secret("steam_key"), scan::steam_id()) {
        (Some(a), Some(k), Some(sid)) => accounts::steam_achievements(http, &k, sid, a).await,
        _ => none("Clé Steam requise (Paramètres)."),
    }
}

/// Records a game's achievement summary. Returns true if it changed.
fn put_sum(app: &AppHandle, id: &str, l: &accounts::AchList) -> bool {
    if l.total == 0 {
        return false;
    }
    let st = app.state::<AppState>();
    let mut m = st.achsum.lock().unwrap();
    m.insert(id.to_string(), [l.unlocked, l.total]) != Some([l.unlocked, l.total])
}

/// Saves and tells the interface (once per batch, not once per game).
fn flush_sums(app: &AppHandle) {
    let st = app.state::<AppState>();
    let m = st.achsum.lock().unwrap().clone();
    save(&st.dir.join("achsum.json"), &m);
    let _ = app.emit("achsum", &m);
}

fn store_sum(app: &AppHandle, id: &str, l: &accounts::AchList) {
    if put_sum(app, id, l) {
        flush_sums(app);
    }
}

#[tauri::command]
async fn achievements(app: AppHandle, id: String) -> Result<accounts::AchList, String> {
    let st = app.state::<AppState>();
    let g = st.lib.lock().unwrap().iter().find(|g| g.id == id).cloned().ok_or("Jeu introuvable")?;
    let http = st.http.clone();
    let l = game_achievements(&http, &g).await;
    store_sum(&app, &id, &l);
    Ok(l)
}

/// Background pass filling the achievement summary of every played game.
#[tauri::command]
async fn sync_achievements(app: AppHandle) -> Result<(), String> {
    let st = app.state::<AppState>();
    {
        let mut b = st.ach_busy.lock().unwrap();
        if *b {
            return Ok(());
        }
        *b = true;
    }
    let steam_ok = accounts::secret("steam_key").is_some();
    let epic_ok = accounts::secret("epic_refresh").is_some();
    let todo: Vec<Game> = st.lib.lock().unwrap().iter().filter(|g| {
        (g.source == "steam" && steam_ok && g.playtime_min > 0) || (g.source == "epic" && epic_ok && g.epic_ns.is_some())
    }).cloned().collect();
    let http = st.http.clone();
    let mut s = futures::stream::iter(todo.into_iter().map(|g| {
        let c = http.clone();
        async move {
            let l = game_achievements(&c, &g).await;
            (g.id, l)
        }
    }))
    .buffer_unordered(4);
    // only changed summaries count, and the interface hears about them in batches
    let (mut pending, mut last) = (0usize, std::time::Instant::now());
    while let Some((id, l)) = s.next().await {
        if put_sum(&app, &id, &l) {
            pending += 1;
        }
        if pending > 0 && (pending >= 40 || last.elapsed() > std::time::Duration::from_secs(4)) {
            flush_sums(&app);
            pending = 0;
            last = std::time::Instant::now();
        }
    }
    if pending > 0 {
        flush_sums(&app);
    }
    *st.ach_busy.lock().unwrap() = false;
    Ok(())
}

#[tauri::command]
fn open_folder(st: State<AppState>, id: String) -> Result<(), String> {
    let p = st.lib.lock().unwrap().iter().find(|g| g.id == id).and_then(|g| g.install_path.clone()).ok_or("Dossier inconnu")?;
    std::process::Command::new("explorer").arg(p).spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    let ok = ["https://", "steam://", "com.epicgames.launcher://", "goggalaxy://"].iter().any(|p| url.starts_with(p));
    if !ok {
        return Err("Lien refusé".into());
    }
    open_target(&url)
}

#[tauri::command]
async fn news(app: AppHandle, appid: u32) -> Result<serde_json::Value, String> {
    let http = app.state::<AppState>().http.clone();
    Ok(serde_json::to_value(meta::news(&http, appid).await).unwrap_or_default())
}

#[tauri::command]
async fn free_games(app: AppHandle) -> Result<serde_json::Value, String> {
    let http = app.state::<AppState>().http.clone();
    Ok(serde_json::to_value(meta::epic_free(&http).await).unwrap_or_default())
}

#[tauri::command]
fn get_memos(st: State<AppState>) -> HashMap<String, String> {
    st.memos.lock().unwrap().clone()
}

#[tauri::command]
fn set_memo(st: State<AppState>, id: String, text: String) {
    let mut m = st.memos.lock().unwrap();
    if text.trim().is_empty() {
        m.remove(&id);
    } else {
        m.insert(id, text);
    }
    save(&st.dir.join("memos.json"), &*m);
}

#[tauri::command]
fn set_wallpaper(st: State<AppState>, data_url: String) -> Result<(), String> {
    use base64::Engine;
    let _ = fs::remove_file(st.dir.join("wallpaper.txt"));
    for e in fs::read_dir(&st.dir).into_iter().flatten().flatten() {
        if e.file_name().to_string_lossy().starts_with("wallpaper") {
            let _ = fs::remove_file(e.path());
        }
    }
    if data_url.is_empty() {
        return Ok(());
    }
    let p = st.dir.join(format!("wallpaper-{}.jpg", now()));
    let (head, data) = data_url.split_once(',').ok_or("Image invalide")?;
    if !head.starts_with("data:image/") {
        return Err("Ce fichier n'est pas une image.".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD.decode(data).map_err(|e| e.to_string())?;
    image::load_from_memory(&bytes).map_err(|_| "Format d'image non pris en charge (JPG, PNG, WebP…)".to_string())?;
    fs::write(&p, bytes).map_err(|e| e.to_string())?;
    Ok(())
}

/// Dominant colours of a local picture (custom wallpaper): [accent, deep].
#[tauri::command]
async fn image_accent(path: String) -> Option<[String; 2]> {
    let bytes = fs::read(&path).ok()?;
    tauri::async_runtime::spawn_blocking(move || meta::accent(&bytes)).await.ok().flatten().map(|(a, d)| [a, d])
}

#[tauri::command]
fn get_wallpaper(st: State<AppState>) -> Option<String> {
    fs::read_dir(&st.dir).ok()?.flatten()
        .filter(|e| { let n = e.file_name().to_string_lossy().to_string(); n.starts_with("wallpaper-") && n.ends_with(".jpg") })
        .map(|e| e.path().to_string_lossy().to_string())
        .max()
}

// ---------- user data (collections, favourites, hidden, settings) ----------

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Coll {
    name: String,
    color: String,
    ids: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct User {
    collections: Vec<Coll>,
    favorites: Vec<String>,
    hidden: Vec<String>,
    close_to_tray: bool,
    autostart: bool,
    notify: bool,
    auto_backup: bool,
    backup_dir: Option<String>,
    seen_free: Vec<String>,
    seen_deals: Vec<String>,
    /// Letterboxd-style ratings: id -> { stars (0.5..5), heart, review, date }
    ratings: HashMap<String, serde_json::Value>,
    update_url: Option<String>,
    lang: String,
}
impl Default for User {
    fn default() -> Self {
        User { collections: vec![], favorites: vec![], hidden: vec![], close_to_tray: true, autostart: false, notify: true, auto_backup: true, backup_dir: None, seen_free: vec![], seen_deals: vec![], ratings: HashMap::new(), update_url: None, lang: "en".into() }
    }
}

fn user_path(st: &AppState) -> PathBuf {
    st.dir.join("user.json")
}
fn user(st: &AppState) -> User {
    load(&user_path(st))
}

#[tauri::command]
fn get_user(st: State<AppState>) -> User {
    let mut u = user(&st);
    u.autostart = autostart_on();
    u
}

#[tauri::command]
fn set_user(st: State<AppState>, mut u: User) -> Result<(), String> {
    let old = user(&st);
    u.seen_free = old.seen_free;
    u.seen_deals = old.seen_deals;
    set_autostart(u.autostart)?;
    accounts::FR.store(u.lang == "fr", std::sync::atomic::Ordering::Relaxed);
    save(&user_path(&st), &u);
    Ok(())
}

const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";

fn autostart_on() -> bool {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};
    RegKey::predef(HKEY_CURRENT_USER).open_subkey(RUN_KEY).and_then(|k| k.get_value::<String, _>("Ultimate")).is_ok()
}

fn set_autostart(on: bool) -> Result<(), String> {
    use winreg::{enums::{HKEY_CURRENT_USER, KEY_SET_VALUE}, RegKey};
    let k = RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(RUN_KEY, KEY_SET_VALUE).map_err(|e| e.to_string())?;
    let _ = k.delete_value("Launcher"); // old name
    if on {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        k.set_value("Ultimate", &format!("\"{}\" --hidden", exe.display())).map_err(|e| e.to_string())
    } else {
        let _ = k.delete_value("Ultimate");
        Ok(())
    }
}

// ---------- history (daily playtime snapshots, for stats) ----------

fn ymd(ts: u64) -> String {
    let z = (ts / 86400) as i64 + 719468;
    let era = z.div_euclid(146097);
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}-{m:02}-{d:02}")
}

fn snapshot(st: &AppState) {
    let p = st.dir.join("history.json");
    let mut h: std::collections::BTreeMap<String, HashMap<String, u64>> = load(&p);
    let today: HashMap<String, u64> = st.lib.lock().unwrap().iter().filter(|g| g.playtime_min > 0).map(|g| (g.id.clone(), g.playtime_min)).collect();
    h.insert(ymd(now()), today);
    while h.len() > 400 {
        let k = h.keys().next().cloned().unwrap();
        h.remove(&k);
    }
    save(&p, &h);
}

#[tauri::command]
fn get_history(st: State<AppState>) -> serde_json::Value {
    let h: serde_json::Value = load(&st.dir.join("history.json"));
    h
}

// ---------- Steam social & store ----------

fn steam_creds() -> Result<(String, u64), String> {
    let k = accounts::secret("steam_key").ok_or("Ajoute ta clé Steam dans les Paramètres.")?;
    let s = scan::steam_id().ok_or("Compte Steam introuvable")?;
    Ok((k, s))
}

#[tauri::command]
async fn friends(app: AppHandle) -> Result<serde_json::Value, String> {
    let (k, s) = steam_creds()?;
    let http = app.state::<AppState>().http.clone();
    Ok(serde_json::to_value(extra::friends(&http, &k, s).await?).unwrap_or_default())
}

#[tauri::command]
async fn wishlist(app: AppHandle) -> Result<serde_json::Value, String> {
    let (k, s) = steam_creds()?;
    let http = app.state::<AppState>().http.clone();
    Ok(serde_json::to_value(extra::wishlist(&http, &k, s).await?).unwrap_or_default())
}

#[tauri::command]
async fn steam_free_games(app: AppHandle) -> Result<serde_json::Value, String> {
    let http = app.state::<AppState>().http.clone();
    Ok(serde_json::to_value(extra::steam_free(&http).await).unwrap_or_default())
}

#[tauri::command]
async fn gog_free_games(app: AppHandle) -> Result<serde_json::Value, String> {
    let http = app.state::<AppState>().http.clone();
    Ok(serde_json::to_value(extra::gog_free(&http).await).unwrap_or_default())
}

#[tauri::command]
fn screenshots(st: State<AppState>, id: String) -> Vec<String> {
    let appid = st.lib.lock().unwrap().iter().find(|g| g.id == id).and_then(|g| if g.source == "steam" { g.steam_appid } else { None });
    match appid {
        Some(a) => extra::screenshots(scan::steam_root(), scan::steam_account(), a),
        None => vec![],
    }
}

#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err("Fichier introuvable".into());
    }
    std::process::Command::new("explorer").arg(&p).spawn().map(|_| ()).map_err(|e| e.to_string())
}

// ---------- save backups ----------

fn backup_dir(st: &AppState) -> PathBuf {
    user(st).backup_dir.map(PathBuf::from).unwrap_or_else(|| {
        let docs = std::env::var("USERPROFILE").map(|h| PathBuf::from(h).join("Documents")).unwrap_or_else(|_| st.dir.clone());
        docs.join("Ultimate - Sauvegardes")
    })
}

async fn backup_game(app: &AppHandle, g: &Game) -> Result<(u64, PathBuf), String> {
    let st = app.state::<AppState>();
    let m = saves::manifest(&st.http.clone(), &st.dir).await?;
    let dest = backup_dir(&st);
    let (name, appid, base) = (g.name.clone(), g.steam_appid, g.install_path.clone());
    tauri::async_runtime::spawn_blocking(move || saves::backup(&m, &dest, &name, appid, base.as_deref())).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn backup_save(app: AppHandle, id: String) -> Result<String, String> {
    let g = app.state::<AppState>().lib.lock().unwrap().iter().find(|g| g.id == id).cloned().ok_or("Jeu introuvable")?;
    let (n, p) = backup_game(&app, &g).await?;
    Ok(format!("{n} → {}", p.display()))
}

#[tauri::command]
fn open_backups(st: State<AppState>) -> Result<(), String> {
    let d = backup_dir(&st);
    let _ = fs::create_dir_all(&d);
    std::process::Command::new("explorer").arg(d).spawn().map(|_| ()).map_err(|e| e.to_string())
}

// ---------- background: free games & deals notifications ----------

fn notify(app: &AppHandle, title: &str, body: &str) {
    use tauri_plugin_notification::NotificationExt;
    let _ = app.notification().builder().title(title).body(body).show();
}

async fn watch_deals(app: AppHandle) {
    loop {
        let st = app.state::<AppState>();
        let mut u = user(&st);
        if u.notify {
            let http = st.http.clone();
            let mut new_free = Vec::new();
            if let Ok(v) = serde_json::to_value(meta::epic_free(&http).await) {
                for f in v.as_array().into_iter().flatten() {
                    if f.get("upcoming").and_then(|x| x.as_bool()) == Some(false) {
                        let t = f.get("title").and_then(|x| x.as_str()).unwrap_or("").to_string();
                        if !t.is_empty() && !u.seen_free.contains(&format!("epic:{t}")) {
                            u.seen_free.push(format!("epic:{t}"));
                            new_free.push(format!("{t} (Epic)"));
                        }
                    }
                }
            }
            for d in extra::steam_free(&http).await {
                let k = format!("steam:{}", d.appid);
                if !u.seen_free.contains(&k) {
                    u.seen_free.push(k);
                    new_free.push(format!("{} (Steam)", d.name));
                }
            }
            if let Ok(v) = serde_json::to_value(extra::gog_free(&http).await) {
                for f in v.as_array().into_iter().flatten() {
                    let t = f.get("title").and_then(|x| x.as_str()).unwrap_or("").to_string();
                    if !t.is_empty() && !u.seen_free.contains(&format!("gog:{t}")) {
                        u.seen_free.push(format!("gog:{t}"));
                        new_free.push(format!("{t} (GOG)"));
                    }
                }
            }
            if !new_free.is_empty() {
                notify(&app, if u.lang == "fr" { "Jeux gratuits" } else { "Free games" }, &new_free.join(", "));
            }
            if let Ok((k, s)) = steam_creds() {
                if let Ok(w) = extra::wishlist(&http, &k, s).await {
                    let hot: Vec<_> = w.iter().filter(|d| d.discount >= 20 && !u.seen_deals.contains(&format!("{}:{}", d.appid, d.discount))).collect();
                    if !hot.is_empty() {
                        let names: Vec<String> = hot.iter().take(4).map(|d| format!("{} -{} %", d.name, d.discount)).collect();
                        notify(&app, if u.lang == "fr" { "Promos" } else { "Deals" }, &names.join(", "));
                        for d in hot {
                            u.seen_deals.push(format!("{}:{}", d.appid, d.discount));
                        }
                    }
                }
            }
            u.seen_free.truncate(500);
            u.seen_deals.truncate(1000);
            let mut cur = user(&st);
            cur.seen_free = u.seen_free;
            cur.seen_deals = u.seen_deals;
            save(&user_path(&st), &cur);
        }
        tokio::time::sleep(std::time::Duration::from_secs(6 * 3600)).await;
    }
}

// ---------- games added by hand (.exe) ----------

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Custom {
    id: String,
    name: String,
    exe: String,
    steam_appid: Option<u32>,
}

fn customs(st: &AppState) -> Vec<Custom> {
    load(&st.dir.join("custom.json"))
}

fn custom_games(st: &AppState) -> Vec<Game> {
    customs(st).into_iter().map(|c| {
        let dir = PathBuf::from(&c.exe).parent().map(|p| p.to_string_lossy().to_string());
        Game {
            id: c.id,
            source: "pc".into(),
            name: c.name,
            steam_appid: c.steam_appid,
            launch: c.exe.clone(),
            install_path: dir,
            installed: PathBuf::from(&c.exe).exists(),
            ..Default::default()
        }
    }).collect()
}

/// Nice default name from the file: "D:\Games\Hollow Knight\hollow_knight.exe" -> "Hollow Knight".
fn guess_name(exe: &str) -> String {
    let p = PathBuf::from(exe);
    let stem = p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let generic = ["game", "launcher", "start", "play", "main", "app", "client", "win64", "shipping"];
    let low = stem.to_lowercase();
    let pick = if generic.iter().any(|g| low == *g || low.ends_with("-win64-shipping") || low.starts_with("unitycrash")) {
        p.parent().and_then(|d| d.file_name()).map(|s| s.to_string_lossy().to_string()).unwrap_or(stem)
    } else {
        stem
    };
    let spaced: String = pick.replace(['_', '.'], " ").split_whitespace().collect::<Vec<_>>().join(" ");
    // "HollowKnight" -> "Hollow Knight"
    let mut out = String::new();
    let mut prev_lower = false;
    for ch in spaced.chars() {
        if ch.is_uppercase() && prev_lower {
            out.push(' ');
        }
        prev_lower = ch.is_lowercase();
        out.push(ch);
    }
    out
}

#[tauri::command]
async fn add_custom(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let picked = app.dialog().file().set_title("Choisir le jeu à ajouter").add_filter("Jeux et raccourcis", &["exe", "lnk", "url", "bat"]).blocking_pick_file();
    let Some(path) = picked.and_then(|p| p.into_path().ok()) else { return Ok(None) };
    let exe = path.to_string_lossy().to_string();
    let st = app.state::<AppState>();
    let mut list = customs(&st);
    if let Some(c) = list.iter().find(|c| c.exe.eq_ignore_ascii_case(&exe)) {
        return Ok(Some(c.id.clone()));
    }
    let name = guess_name(&exe);
    let appid = meta::search_steam(&st.http.clone(), &name).await;
    let id = format!("pc:{:x}", exe.to_lowercase().bytes().fold(0xcbf29ce484222325u64, |h, b| (h ^ b as u64).wrapping_mul(0x100000001b3)));
    list.push(Custom { id: id.clone(), name, exe, steam_appid: appid });
    save(&st.dir.join("custom.json"), &list);
    Ok(Some(id))
}

#[tauri::command]
fn update_custom(st: State<AppState>, id: String, name: String, steam_appid: Option<u32>) -> Result<(), String> {
    let mut list = customs(&st);
    let c = list.iter_mut().find(|c| c.id == id).ok_or("Jeu introuvable")?;
    c.name = name.trim().to_string();
    c.steam_appid = steam_appid;
    save(&st.dir.join("custom.json"), &list);
    // force fresh metadata for this one
    if let Some(g) = st.lib.lock().unwrap().iter_mut().find(|g| g.id == id) {
        g.enriched = false;
        g.meta_v = 0;
    }
    Ok(())
}

#[tauri::command]
fn remove_custom(st: State<AppState>, id: String) {
    let list: Vec<Custom> = customs(&st).into_iter().filter(|c| c.id != id).collect();
    save(&st.dir.join("custom.json"), &list);
    st.lib.lock().unwrap().retain(|g| g.id != id);
}

#[tauri::command]
async fn steam_search(app: AppHandle, q: String) -> Result<serde_json::Value, String> {
    let http = app.state::<AppState>().http.clone();
    Ok(serde_json::to_value(meta::steam_search_list(&http, &q).await).unwrap_or_default())
}

// ---------- HowLongToBeat ----------

#[tauri::command]
async fn hltb(app: AppHandle, id: String) -> Result<Option<meta::Hltb>, String> {
    let st = app.state::<AppState>();
    let p = st.dir.join("hltb.json");
    let mut cache: HashMap<String, Option<meta::Hltb>> = load(&p);
    if let Some(v) = cache.get(&id) {
        return Ok(v.clone());
    }
    let name = st.lib.lock().unwrap().iter().find(|g| g.id == id).map(|g| g.name.clone()).ok_or("Jeu introuvable")?;
    let r = meta::hltb(&st.http.clone(), &name).await?;
    cache.insert(id, r.clone());
    save(&p, &cache);
    Ok(r)
}

// ---------- self-update ----------

#[derive(Serialize)]
struct UpdateInfo {
    version: String,
    current: String,
    notes: Option<String>,
}

const DEFAULT_UPDATE_URL: &str = "https://github.com/Desarrh/ultimate/releases/latest/download/latest.json";

fn update_url(st: &AppState) -> Option<String> {
    Some(user(st).update_url.filter(|u| u.starts_with("https://")).unwrap_or_else(|| DEFAULT_UPDATE_URL.into()))
}

#[tauri::command]
async fn check_update(app: AppHandle) -> Result<Option<UpdateInfo>, String> {
    use tauri_plugin_updater::UpdaterExt;
    let Some(url) = update_url(&app.state::<AppState>()) else { return Ok(None) };
    let up = app.updater_builder().endpoints(vec![url.parse().map_err(|e: url::ParseError| e.to_string())?]).map_err(|e| e.to_string())?.build().map_err(|e| e.to_string())?;
    match up.check().await.map_err(|e| e.to_string())? {
        Some(u) => Ok(Some(UpdateInfo { version: u.version.clone(), current: u.current_version.clone(), notes: u.body.clone() })),
        None => Ok(None),
    }
}

#[tauri::command]
async fn install_update(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    let url = update_url(&app.state::<AppState>()).ok_or("Aucune source de mise à jour configurée")?;
    let up = app.updater_builder().endpoints(vec![url.parse().map_err(|e: url::ParseError| e.to_string())?]).map_err(|e| e.to_string())?.build().map_err(|e| e.to_string())?;
    let u = up.check().await.map_err(|e| e.to_string())?.ok_or("Déjà à jour")?;
    u.download_and_install(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
    app.restart();
}

#[tauri::command]
fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

pub fn run() {
    let hidden = std::env::args().any(|a| a == "--hidden");
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .register_asynchronous_uri_scheme_protocol("img", |ctx, req, responder| {
            let app = ctx.app_handle().clone();
            let uri = req.uri().to_string();
            tauri::async_runtime::spawn(async move {
                let st = app.state::<AppState>();
                let (b, m, code) = img::serve(st.dir.join("img-cache"), st.http.clone(), uri).await;
                let resp = tauri::http::Response::builder()
                    .status(code)
                    .header("Content-Type", m)
                    .header("Cache-Control", "max-age=31536000")
                    .header("Access-Control-Allow-Origin", "*")
                    .body(b)
                    .unwrap();
                responder.respond(resp);
            });
        })
        .on_window_event(|w, e| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = e {
                let app = w.app_handle();
                if user(&app.state::<AppState>()).close_to_tray {
                    api.prevent_close();
                    let _ = w.hide();
                }
            }
        })
        .setup(move |app| {
            let dir = app.path().app_data_dir()?;
            fs::create_dir_all(&dir)?;
            let lib: Vec<Game> = load(&dir.join("library.json"));
            let memos: HashMap<String, String> = load(&dir.join("memos.json"));
            let tracked: HashMap<String, u64> = load(&dir.join("tracked.json"));
            let achsum: HashMap<String, [usize; 2]> = load(&dir.join("achsum.json"));
            app.manage(AppState {
                lib: Mutex::new(lib),
                memos: Mutex::new(memos),
                dir,
                busy: Mutex::new(false),
                ach_busy: Mutex::new(false),
                http: meta::client(),
                tracked: Mutex::new(tracked),
                tracking: Mutex::new(HashSet::new()),
                achsum: Mutex::new(achsum),
            });
            use tauri::menu::{Menu, MenuItem};
            use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
            let fr = load::<User>(&app.state::<AppState>().dir.join("user.json")).lang == "fr";
            accounts::FR.store(fr, std::sync::atomic::Ordering::Relaxed);
            let open = MenuItem::with_id(app, "open", if fr { "Ouvrir" } else { "Open" }, true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", if fr { "Quitter" } else { "Quit" }, true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().cloned().expect("icon"))
                .tooltip("Ultimate")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, ev| match ev.id.as_ref() {
                    "open" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, ev| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = ev {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;
            if hidden {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
            }
            tauri::async_runtime::spawn(watch_deals(app.handle().clone()));
            watch_pc(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_cached, refresh, launch, open_folder, open_url, news, free_games, get_memos, set_memo, accounts_status, set_steam_key, epic_login, epic_connect, epic_disconnect, get_achsum, achievements, sync_achievements, set_wallpaper, get_wallpaper, image_accent, get_user, set_user, get_history, friends, wishlist, steam_free_games, gog_free_games, screenshots, open_path, backup_save, open_backups, add_custom, update_custom, remove_custom, steam_search, hltb, check_update, install_update, app_version])
        .run(tauri::generate_context!())
        .expect("erreur au lancement");
}

#[cfg(test)]
mod tests {
    #[test]
    fn ymd_dates() {
        assert_eq!(super::ymd(0), "1970-01-01");
        assert_eq!(super::ymd(1710432249), "2024-03-14");
        assert_eq!(super::ymd(951782400), "2000-02-29");
    }
}
