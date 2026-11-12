mod accounts;
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
    if t.contains("://") {
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
    if o.enriched && o.meta_v == meta::META_V {
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

    // Steam Web API (if a key is set): every owned game + exact playtime
    if let (Some(key), Some(sid)) = (accounts::secret("steam_key"), scan::steam_id()) {
        if let Some(owned) = accounts::steam_owned(&http, &key, sid).await {
            for (id, (name, pt, lp)) in owned {
                match scanned.iter_mut().find(|g| g.steam_appid == Some(id)) {
                    Some(g) => {
                        g.playtime_min = g.playtime_min.max(pt);
                        g.last_played = g.last_played.max(lp);
                    }
                    None => scanned.push(Game {
                        id: format!("steam:{id}"),
                        source: "steam".into(),
                        name,
                        steam_appid: Some(id),
                        launch: format!("steam://rungameid/{id}"),
                        playtime_min: pt,
                        last_played: lp,
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
    if let Some(dir) = g.install_path.filter(|_| g.installed) {
        if st.tracking.lock().unwrap().insert(id.clone()) {
            track(app.clone(), id, dir);
        }
    }
    Ok(())
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
        return none("Pas de succès disponibles pour ce jeu.");
    }
    match (g.steam_appid, accounts::secret("steam_key"), scan::steam_id()) {
        (Some(a), Some(k), Some(sid)) => accounts::steam_achievements(http, &k, sid, a).await,
        _ => none("Ajoute ta clé d'API Steam dans les Paramètres pour voir tes succès."),
    }
}

fn store_sum(app: &AppHandle, id: &str, l: &accounts::AchList) {
    if l.total == 0 {
        return;
    }
    let st = app.state::<AppState>();
    let m = {
        let mut m = st.achsum.lock().unwrap();
        m.insert(id.to_string(), [l.unlocked, l.total]);
        m.clone()
    };
    save(&st.dir.join("achsum.json"), &m);
    let _ = app.emit("achsum", &m);
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
    while let Some((id, l)) = s.next().await {
        store_sum(&app, &id, &l);
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
    let p = st.dir.join("wallpaper.txt");
    if data_url.is_empty() {
        let _ = fs::remove_file(p);
        return Ok(());
    }
    if !data_url.starts_with("data:image/") {
        return Err("Ce fichier n'est pas une image.".into());
    }
    if data_url.len() > 40_000_000 {
        return Err("Image trop lourde (30 Mo max).".into());
    }
    fs::write(p, data_url).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_wallpaper(st: State<AppState>) -> Option<String> {
    fs::read_to_string(st.dir.join("wallpaper.txt")).ok()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_cached, refresh, launch, open_folder, open_url, news, free_games, get_memos, set_memo, accounts_status, set_steam_key, epic_login, epic_connect, epic_disconnect, get_achsum, achievements, sync_achievements, set_wallpaper, get_wallpaper])
        .run(tauri::generate_context!())
        .expect("erreur au lancement");
}
