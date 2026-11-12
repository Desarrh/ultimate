//! Save-game backups using the community Ludusavi manifest (where each game keeps its saves).

use std::{collections::HashMap, fs, path::{Path, PathBuf}, time::{Duration, SystemTime}};

const MANIFEST: &str = "https://raw.githubusercontent.com/mtkennerly/ludusavi-manifest/master/data/manifest.yaml";

pub async fn manifest(c: &reqwest::Client, dir: &Path) -> Result<PathBuf, String> {
    let p = dir.join("ludusavi-manifest.yaml");
    let fresh = fs::metadata(&p).ok().and_then(|m| m.modified().ok()).map(|t| SystemTime::now().duration_since(t).unwrap_or_default() < Duration::from_secs(7 * 86400)).unwrap_or(false);
    if !fresh {
        let r = c.get(MANIFEST).timeout(Duration::from_secs(120)).send().await.map_err(|e| e.to_string())?;
        let b = r.error_for_status().map_err(|e| e.to_string())?.bytes().await.map_err(|e| e.to_string())?;
        fs::write(&p, &b).map_err(|e| e.to_string())?;
    }
    Ok(p)
}

fn norm(s: &str) -> String {
    s.to_lowercase().chars().filter(|c| c.is_alphanumeric()).collect()
}

fn unquote(s: &str) -> String {
    let s = s.trim();
    if (s.starts_with('"') && s.ends_with('"')) || (s.starts_with('\'') && s.ends_with('\'')) {
        s[1..s.len() - 1].replace("\\\"", "\"").replace("''", "'")
    } else {
        s.to_string()
    }
}

/// Save path patterns for a game (Windows ones only).
pub fn patterns(manifest: &Path, name: &str, appid: Option<u32>) -> Vec<String> {
    let Ok(txt) = fs::read_to_string(manifest) else { return vec![] };
    let want = norm(name);
    let mut best: Option<&str> = None;
    let mut block_start = 0usize;
    let mut cur_name = String::new();
    let mut in_steam = false;
    let mut offset = 0usize;
    let mut found_by_id = false;
    let lines: Vec<&str> = txt.split('\n').collect();
    let mut starts: Vec<(usize, String)> = Vec::new();
    for (i, l) in lines.iter().enumerate() {
        let l = l.trim_end_matches('\r');
        if !l.starts_with(' ') && l.ends_with(':') && !l.starts_with('#') && !l.is_empty() {
            starts.push((i, unquote(&l[..l.len() - 1])));
            cur_name = starts.last().unwrap().1.clone();
            block_start = i;
            in_steam = false;
            if best.is_none() && norm(&cur_name) == want {
                offset = i;
                best = Some("name");
            }
        } else if l == "  steam:" {
            in_steam = true;
        } else if in_steam && l.starts_with("    id: ") {
            if Some(l[8..].trim().parse::<u32>().unwrap_or(0)) == appid && appid.is_some() {
                offset = block_start;
                found_by_id = true;
                break;
            }
        } else if l.starts_with("  ") && !l.starts_with("   ") {
            in_steam = false;
        }
    }
    let _ = cur_name;
    if best.is_none() && !found_by_id {
        return vec![];
    }
    // collect "  files:" entries of that block
    let mut out = Vec::new();
    let mut in_files = false;
    let mut current: Option<String> = None;
    let mut win_ok = true;
    let flush = |cur: &mut Option<String>, ok: bool, out: &mut Vec<String>| {
        if let Some(p) = cur.take() {
            if ok {
                out.push(p);
            }
        }
    };
    for l in lines.iter().skip(offset + 1) {
        let l = l.trim_end_matches('\r');
        if !l.starts_with(' ') && !l.is_empty() {
            break;
        }
        if l.starts_with("  ") && !l.starts_with("   ") {
            flush(&mut current, win_ok, &mut out);
            in_files = l.trim() == "files:";
            continue;
        }
        if !in_files {
            continue;
        }
        if l.starts_with("    ") && !l.starts_with("     ") && l.trim_end().ends_with(':') {
            flush(&mut current, win_ok, &mut out);
            let t = l.trim();
            current = Some(unquote(&t[..t.len() - 1]));
            win_ok = true;
        } else if l.contains("os: ") {
            let os = l.split("os: ").nth(1).unwrap_or("").trim();
            if os != "windows" {
                // only skip if no windows condition in this entry: approximated by "first os wins"
                win_ok = win_ok && os == "windows";
            }
        }
    }
    flush(&mut current, win_ok, &mut out);
    out
}

fn known_folder(name: &str) -> Option<String> {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};
    let k = RegKey::predef(HKEY_CURRENT_USER).open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders").ok()?;
    k.get_value::<String, _>(name).ok()
}

fn expand(p: &str, base: Option<&str>, appid: Option<u32>) -> Option<String> {
    let env = |k: &str| std::env::var(k).ok();
    let home = env("USERPROFILE")?;
    let mut m: HashMap<&str, String> = HashMap::new();
    m.insert("<home>", home.clone());
    m.insert("<winAppData>", env("APPDATA").unwrap_or_else(|| format!("{home}\\AppData\\Roaming")));
    m.insert("<winLocalAppData>", env("LOCALAPPDATA").unwrap_or_else(|| format!("{home}\\AppData\\Local")));
    m.insert("<winLocalAppDataLow>", format!("{home}\\AppData\\LocalLow"));
    m.insert("<winDocuments>", known_folder("Personal").unwrap_or_else(|| format!("{home}\\Documents")));
    m.insert("<winPublic>", env("PUBLIC").unwrap_or_else(|| "C:\\Users\\Public".into()));
    m.insert("<winProgramData>", env("PROGRAMDATA").unwrap_or_else(|| "C:\\ProgramData".into()));
    m.insert("<winDir>", env("WINDIR").unwrap_or_else(|| "C:\\Windows".into()));
    m.insert("<osUserName>", env("USERNAME").unwrap_or_default());
    m.insert("<storeUserId>", "*".into());
    m.insert("<storeGameId>", appid.map(|a| a.to_string()).unwrap_or_else(|| "*".into()));
    let mut s = p.to_string();
    if s.contains("<base>") || s.contains("<root>") || s.contains("<game>") {
        let b = base?;
        s = s.replace("<base>", b);
        let gp = Path::new(b);
        s = s.replace("<game>", gp.file_name()?.to_str()?);
        s = s.replace("<root>", gp.parent()?.to_str()?);
    }
    for (k, v) in m {
        s = s.replace(k, &v);
    }
    if s.contains('<') || s.starts_with('~') {
        return None; // unsupported placeholder (Linux / Mac only)
    }
    Some(s.replace('/', "\\"))
}

fn copy_into(src: &Path, dest_root: &Path, n: &mut u64) {
    let rel: PathBuf = src.components().filter_map(|c| match c {
        std::path::Component::Prefix(p) => Some(p.as_os_str().to_string_lossy().replace(':', "").into()),
        std::path::Component::Normal(x) => Some(x.to_os_string()),
        _ => None,
    }).collect();
    let dst = dest_root.join(rel);
    if src.is_dir() {
        if let Ok(rd) = fs::read_dir(src) {
            for e in rd.flatten() {
                copy_into(&e.path(), dest_root, n);
            }
        }
    } else if let Ok(m) = fs::metadata(src) {
        if m.len() < 2_000_000_000 {
            if let Some(p) = dst.parent() {
                let _ = fs::create_dir_all(p);
            }
            if fs::copy(src, &dst).is_ok() {
                *n += 1;
            }
        }
    }
}

/// Copies every save file of the game into `<backup_dir>/<game>/<date>`. Returns (files, folder).
pub fn backup(manifest: &Path, backup_dir: &Path, name: &str, appid: Option<u32>, base: Option<&str>) -> Result<(u64, PathBuf), String> {
    let pats = patterns(manifest, name, appid);
    if pats.is_empty() {
        return Err(format!("Emplacement des sauvegardes de {name} inconnu."));
    }
    let safe: String = name.chars().map(|c| if c.is_alphanumeric() || c == ' ' || c == '-' { c } else { '_' }).collect();
    let stamp = {
        let s = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap_or_default().as_secs();
        format!("{}", s)
    };
    let dest = backup_dir.join(safe.trim()).join(stamp);
    let mut n = 0u64;
    for p in pats {
        let Some(x) = expand(&p, base, appid) else { continue };
        if let Ok(paths) = glob::glob(&x) {
            for m in paths.flatten() {
                copy_into(&m, &dest, &mut n);
            }
        }
    }
    if n == 0 {
        let _ = fs::remove_dir_all(&dest);
        return Err("Aucun fichier de sauvegarde trouvé sur ce PC.".into());
    }
    Ok((n, dest))
}

#[cfg(test)]
mod tests {
    use super::*;
    const MANIFEST: &str = "Valheim:\n  files:\n    <home>/AppData/LocalLow/IronGate/Valheim/worlds_local:\n      tags:\n        - save\n      when:\n        - os: windows\n    <home>/.config/unity3d/IronGate/Valheim:\n      when:\n        - os: linux\n  steam:\n    id: 892970\n\"Some: Game\":\n  files:\n    <winDocuments>/My Games/Some:\n      tags:\n        - save\n";
    fn write() -> PathBuf {
        let p = std::env::temp_dir().join(format!("launcher-test-manifest-{}.yaml", std::process::id()));
        fs::write(&p, MANIFEST).unwrap();
        p
    }
    #[test]
    fn finds_windows_paths_by_steam_id_and_name() {
        let m = write();
        let by_id = patterns(&m, "nom différent", Some(892970));
        assert_eq!(by_id, vec!["<home>/AppData/LocalLow/IronGate/Valheim/worlds_local".to_string()]);
        let by_name = patterns(&m, "Some Game", None);
        assert_eq!(by_name, vec!["<winDocuments>/My Games/Some".to_string()]);
        assert!(patterns(&m, "Inconnu", Some(1)).is_empty());
        let _ = fs::remove_file(m);
    }
    #[test]
    fn expands_placeholders() {
        let p = expand("<home>/AppData/<storeUserId>/x", None, None).unwrap();
        assert!(p.ends_with("\\AppData\\*\\x"), "{p}");
        assert!(expand("<base>/saves", None, None).is_none(), "needs install dir");
        assert_eq!(expand("<base>/saves", Some("D:\\Games\\Foo"), None).as_deref(), Some("D:\\Games\\Foo\\saves"));
        assert!(expand("<xdgConfig>/x", None, None).is_none());
    }
}
