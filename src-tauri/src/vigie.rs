//! Optional bridge to Vigie (task manager / RAM hunter, a separate app). Ultimate never depends on it:
//! if Vigie is missing, too old, slow or crashing, every call here just returns None.

use std::io::Read;
use std::sync::mpsc;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// What this Vigie build understands. An old build would open its window on an unknown flag, so
/// the dev flags are only passed when the exe declares them: Vigie's build.rs writes them in its
/// version resource (`VigieCli` = "avant-jeu apres-jeu etat-dev couper-dev", UTF-16 in the file).
/// `--avant-jeu` / `--apres-jeu` exist in every Vigie ever distributed.
#[derive(Clone, Copy, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Caps {
    pub game_mode: bool,
    pub dev_state: bool,
    pub dev_kill: bool,
    pub game_memory: bool,
    /// `--memoire-jeu` also takes an install folder (Steam / Epic / GOG games)
    pub game_memory_dir: bool,
    /// the exe carries the VigieCli marker (required for a path typed in the settings)
    #[serde(skip)]
    pub marked: bool,
}

static CAPS: Mutex<Option<(PathBuf, SystemTime, Caps)>> = Mutex::new(None);

/// Test sandbox: when `ULTIMATE_TEST_SANDBOX` names a folder, Ultimate only launches games and
/// Vigie found inside it, so an automated test can never start a real game nor cut real servers.
pub fn sandbox() -> Option<PathBuf> {
    std::env::var_os("ULTIMATE_TEST_SANDBOX").filter(|v| !v.is_empty()).map(PathBuf::from)
}

/// Is `p` inside the test sandbox (always true outside test mode)?
pub fn allowed(p: &Path) -> bool {
    match sandbox() {
        None => true,
        Some(root) => p.to_string_lossy().to_lowercase().starts_with(&root.to_string_lossy().to_lowercase()),
    }
}

/// Configured path first (file or folder), then the dev build, then next to Ultimate. Only a file
/// named `Vigie.exe` carrying the VigieCli marker is used: the settings must not become a way to
/// start any program.
pub fn find(configured: Option<&str>) -> Option<PathBuf> {
    let mut c: Vec<PathBuf> = vec![];
    if let Some(p) = configured.map(str::trim).filter(|p| !p.is_empty()) {
        let p = PathBuf::from(p);
        let p = if p.is_dir() { p.join("Vigie.exe") } else { p };
        let named = p.file_name().map(|n| n.to_string_lossy().eq_ignore_ascii_case("vigie.exe")).unwrap_or(false);
        if named && p.is_file() && caps(&p).marked {
            c.push(p);
        }
    }
    c.push(PathBuf::from(r"C:\Dev\vigie\dist\Vigie.exe"));
    if let Some(d) = std::env::current_exe().ok().and_then(|e| e.parent().map(Path::to_path_buf)) {
        c.push(d.join("Vigie.exe"));
    }
    // whatever its place (C:\Dev is writable by any local account), only a Vigie.exe carrying
    // the VigieCli marker is ever run
    c.into_iter().find(|p| p.is_file() && allowed(p) && caps(p).marked)
}

fn contains(hay: &[u8], needle: &[u8]) -> bool {
    hay.windows(needle.len()).any(|w| w == needle)
}

/// The flag as UTF-16LE (version resource) or UTF-8 (a long string literal).
fn declares(exe: &[u8], flag: &str) -> bool {
    let utf16: Vec<u8> = flag.encode_utf16().flat_map(u16::to_le_bytes).collect();
    contains(exe, &utf16) || contains(exe, format!("VigieCli:{flag}").as_bytes())
}

/// Reads the exe once per (path, modification time) and looks for the declared flags.
pub fn caps(exe: &Path) -> Caps {
    let mtime = std::fs::metadata(exe).and_then(|m| m.modified()).unwrap_or(SystemTime::UNIX_EPOCH);
    let mut cache = CAPS.lock().unwrap_or_else(|e| e.into_inner());
    if let Some((p, t, c)) = cache.as_ref() {
        if p == exe && *t == mtime {
            return *c;
        }
    }
    let c = std::fs::read(exe).map(|b| Caps {
        game_mode: true,
        dev_state: declares(&b, "etat-dev"),
        dev_kill: declares(&b, "couper-dev"),
        game_memory: declares(&b, "memoire-jeu"),
        game_memory_dir: declares(&b, "memoire-jeu-dossier"),
        marked: contains(&b, &"VigieCli".encode_utf16().flat_map(u16::to_le_bytes).collect::<Vec<u8>>()) || contains(&b, b"VigieCli:"),
    }).unwrap_or_default();
    *cache = Some((exe.to_path_buf(), mtime, c));
    c
}

/// Runs `Vigie <arg>` without a window, returns its trimmed stdout on success, None on
/// failure or after `timeout` (the process is then killed).
pub fn run(exe: &Path, args: &[&str], timeout: Duration) -> Option<String> {
    let mut child = Command::new(exe)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .ok()?;
    let mut out = child.stdout.take()?;
    // the output comes through a channel: a program Vigie starts (wsl --shutdown…) may keep the pipe
    // open after Vigie exits, and a join() would then wait forever
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut s = String::new();
        let _ = out.read_to_string(&mut s);
        let _ = tx.send(s);
    });
    let t0 = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let s = rx.recv_timeout(Duration::from_millis(300)).ok()?;
                return status.success().then(|| s.trim().to_string());
            }
            Ok(None) if t0.elapsed() < timeout => {
                // usually done well before: take the output as soon as it is complete
                if let Ok(s) = rx.recv_timeout(Duration::from_millis(50)) {
                    let status = child.wait().ok()?;
                    return status.success().then(|| s.trim().to_string());
                }
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
}

/// `--etat-dev` output: {"v":1,"items":[{kind,label,pids,ram_mo}],"total_mo":n}. Anything else → None.
pub fn parse_dev_state(s: &str) -> Option<serde_json::Value> {
    let line = s.lines().rev().find(|l| l.trim_start().starts_with('{'))?;
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    (v.get("v")?.as_u64()? == 1 && v.get("items")?.is_array()).then_some(v)
}

/// `--memoire-jeu` output, kept only when the game is known and memory is missing:
/// {"v":1,"connu":true,"nom":"x.exe","pic_mo":9000,"disponible_mo":7600,"manque_mo":1400}.
pub fn parse_game_memory(s: &str) -> Option<serde_json::Value> {
    let line = s.lines().rev().find(|l| l.trim_start().starts_with('{'))?;
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    (v.get("v")?.as_u64()? == 1 && v.get("connu")?.as_bool()? && v.get("manque_mo")?.as_u64()? > 0).then_some(v)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dev_state_format() {
        let ok = r#"{"v":1,"items":[{"kind":"node","label":"npm run dev","pids":[1],"ram_mo":800}],"total_mo":800}"#;
        assert_eq!(parse_dev_state(ok).unwrap()["items"][0]["kind"], "node");
        assert!(parse_dev_state(&format!("log line\n{ok}\n")).is_some());
        assert!(parse_dev_state(r#"{"v":2,"items":[]}"#).is_none());
        assert!(parse_dev_state("2,3 Go libérés").is_none());
        assert!(parse_dev_state("").is_none());
    }

    #[test]
    fn game_memory_format() {
        assert_eq!(parse_game_memory(r#"{"v":1,"connu":true,"nom":"x.exe","pic_mo":9000,"disponible_mo":7600,"manque_mo":1400}"#).unwrap()["manque_mo"], 1400);
        assert!(parse_game_memory(r#"{"connu":false,"disponible_mo":27318,"v":1}"#).is_none());
        assert!(parse_game_memory(r#"{"v":1,"connu":true,"pic_mo":4000,"disponible_mo":7600,"manque_mo":0}"#).is_none());
        assert!(parse_game_memory("").is_none());
    }

    #[test]
    fn missing_vigie_is_quiet() {
        assert!(run(Path::new(r"C:\nope\Vigie.exe"), &["--etat-dev"], Duration::from_millis(200)).is_none());
        let c = caps(Path::new(r"C:\nope\Vigie.exe"));
        assert!(!c.game_mode && !c.dev_state && !c.dev_kill && !c.marked);
        // a typed path to anything else than a marked Vigie.exe is ignored
        let me = std::env::current_exe().unwrap();
        assert_ne!(find(Some(&me.to_string_lossy())).as_deref(), Some(me.as_path()));
        assert_ne!(find(Some(r"C:\Windows\System32\cmd.exe")).as_deref(), Some(Path::new(r"C:\Windows\System32\cmd.exe")));
    }

    #[test]
    fn flags_found_in_binary() {
        let res: Vec<u8> = "avant-jeu apres-jeu etat-dev".encode_utf16().flat_map(u16::to_le_bytes).collect();
        assert!(declares(&res, "etat-dev"));
        assert!(!declares(&res, "couper-dev"));
        assert!(declares(b"..VigieCli:couper-dev..", "couper-dev"));
        assert!(!declares(b"if a == \"--etat-dev\"", "etat-dev")); // a bare literal is not a declaration
    }
}
