//! Game config files for the recommended settings (U6): read, apply with a backup, restore.
//! Only Cyberpunk 2077 (`UserSettings.json`) for now. Only known keys are written, only with values
//! the game is known to accept; the rest of the file (order, format, version) is kept as is.

use serde_json::{ser::PrettyFormatter, Serializer, Value};
use serde::Serialize;
use std::{collections::HashMap, fs, path::{Path, PathBuf}};

/// Where the game keeps its settings. In test mode (`ULTIMATE_TEST_SANDBOX`), a copy inside the
/// sandbox: tests never touch the user's real file.
pub fn cp2077_path() -> Option<PathBuf> {
    if let Some(sb) = crate::vigie::sandbox() {
        return Some(sb.join("cp2077").join("UserSettings.json"));
    }
    Some(PathBuf::from(std::env::var_os("LOCALAPPDATA")?).join("CD Projekt Red").join("Cyberpunk 2077").join("UserSettings.json"))
}

/// Options Ultimate may change (the sheet's settings plus upscaling and display).
const CP_KEYS: &[&str] = &[
    "TextureQuality", "Anisotropy", "LODPreset", "SubsurfaceScatteringQuality", "FacialTangentUpdates", "ColorPrecision",
    "AmbientOcclusion", "ScreenSpaceReflectionsQuality", "VolumetricCloudsQuality", "VolumetricFogResolution", "MirrorQuality",
    "ContactShadows", "LocalShadowsQuality", "ShadowMeshQuality", "CascadedShadowsRange", "CascadedShadowsResolution",
    "DistantShadowsResolution", "MaxDynamicDecals", "CrowdDensity", "RayTracing", "RayTracedPathTracing",
    "ResolutionScaling", "DLSS", "FrameGeneration", "VSync", "MaximumFPS_OnOff", "MaximumFPS_Value", "ReflexMode",
];

/// Lists the game fills at run time (no `values` in the file): value -> index, as found in files
/// written by the game itself (ResolutionScaling DLSS = 1, FSR2 = 2; DLSS Ultra Performance = 5
/// after Auto, DLAA, Quality, Balanced, Performance). Other values are left to the game's menu.
const CP_DYNAMIC: &[(&str, &[(&str, i64)])] = &[
    ("ResolutionScaling", &[("DLSS", 1), ("FSR2", 2)]),
    ("DLSS", &[("Auto", 0), ("DLAA", 1), ("Quality", 2), ("Balanced", 3), ("Performance", 4), ("Ultra Performance", 5)]),
    ("VSync", &[("UI-Settings-Video-QualitySetting-Off", 0)]),
    ("FrameGeneration", &[("Off", 0)]),
];

/// { option: value } of every option in the file.
pub fn cp2077_flat(v: &Value) -> HashMap<String, Value> {
    let mut out = HashMap::new();
    for g in v["data"].as_array().into_iter().flatten() {
        for o in g["options"].as_array().into_iter().flatten() {
            if let (Some(n), Some(val)) = (o["name"].as_str(), o.get("value")) {
                out.insert(n.to_string(), val.clone());
            }
        }
    }
    out
}

/// Sets one option if the new value is valid for it. Ok(true) = changed, Ok(false) = already so,
/// Err = refused (unknown value for that option).
fn set_option(o: &mut serde_json::Map<String, Value>, name: &str, new: &Value) -> Result<bool, ()> {
    if o.get("value") == Some(new) {
        return Ok(false);
    }
    let ty = o.get("type").and_then(Value::as_str).unwrap_or("");
    let index = if let Some(list) = o.get("values").and_then(Value::as_array) {
        Some(list.iter().position(|x| x == new).ok_or(())? as i64)
    } else if let Some((_, l)) = CP_DYNAMIC.iter().find(|(k, _)| *k == name) {
        Some(l.iter().find(|(v, _)| Some(*v) == new.as_str()).ok_or(())?.1)
    } else {
        match ty {
            "bool" if new.is_boolean() => None,
            "int" => {
                let n = new.as_i64().ok_or(())?;
                let lo = o.get("min_value").and_then(Value::as_i64).unwrap_or(i64::MIN);
                let hi = o.get("max_value").and_then(Value::as_i64).unwrap_or(i64::MAX);
                if n < lo || n > hi {
                    return Err(());
                }
                None
            }
            _ => return Err(()),
        }
    };
    o.insert("value".into(), new.clone());
    if let (Some(i), true) = (index, o.contains_key("index")) {
        o.insert("index".into(), i.into());
    }
    Ok(true)
}

#[derive(Serialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Applied {
    pub changed: Vec<String>,
    /// asked but not written (unknown key or a value the game may not accept): set in the game
    pub skipped: Vec<String>,
    pub backup: Option<String>,
}

/// Applies `values` to the parsed file. Pure: no disk access.
pub fn cp2077_apply(doc: &mut Value, values: &HashMap<String, Value>) -> Applied {
    let mut res = Applied::default();
    let mut seen = std::collections::HashSet::new();
    for g in doc["data"].as_array_mut().into_iter().flatten() {
        for o in g["options"].as_array_mut().into_iter().flatten() {
            let Some(o) = o.as_object_mut() else { continue };
            let Some(name) = o.get("name").and_then(Value::as_str).map(str::to_string) else { continue };
            let Some(new) = values.get(&name) else { continue };
            seen.insert(name.clone());
            if !CP_KEYS.contains(&name.as_str()) {
                res.skipped.push(name);
                continue;
            }
            match set_option(o, &name, new) {
                Ok(true) => res.changed.push(name),
                Ok(false) => {}
                Err(()) => res.skipped.push(name),
            }
        }
    }
    res.skipped.extend(values.keys().filter(|k| !seen.contains(*k)).cloned());
    res.skipped.sort();
    res
}

/// Same layout as the game: 4-space indentation, key order kept.
pub fn to_game_json(doc: &Value) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    let mut ser = Serializer::with_formatter(&mut out, PrettyFormatter::with_indent(b"    "));
    doc.serialize(&mut ser).map_err(|e| e.to_string())?;
    Ok(out)
}

/// The config as it was before Ultimate ever wrote it: created on the first « Appliquer »,
/// never overwritten, so « Restaurer » always goes back to the user's own settings.
const ORIGINAL: &str = "UserSettings.json.avant-ultimate.bak";

/// Ultimate's backup next to the file, if any (never the user's other `.bak` files).
pub fn backups(file: &Path) -> Vec<PathBuf> {
    let p = file.with_file_name(ORIGINAL);
    if p.is_file() { vec![p] } else { vec![] }
}

fn write_atomic(file: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = file.with_extension("json.ultimate-tmp");
    fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    fs::rename(&tmp, file).map_err(|e| { let _ = fs::remove_file(&tmp); e.to_string() })
}

/// Backup (first time only), then write. The backup is the exact original bytes.
pub fn apply_file(file: &Path, values: &HashMap<String, Value>) -> Result<Applied, String> {
    use std::io::Write;
    let orig = fs::read(file).map_err(|e| e.to_string())?;
    let mut doc: Value = serde_json::from_slice(&orig).map_err(|e| e.to_string())?;
    let mut res = cp2077_apply(&mut doc, values);
    if res.changed.is_empty() {
        return Ok(res);
    }
    let bak = file.with_file_name(ORIGINAL);
    match fs::OpenOptions::new().write(true).create_new(true).open(&bak) {
        Ok(mut f) => f.write_all(&orig).and_then(|_| f.sync_all()).map_err(|e| { let _ = fs::remove_file(&bak); e.to_string() })?,
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {} // keep the very first one
        Err(e) => return Err(e.to_string()),
    }
    write_atomic(file, &to_game_json(&doc)?)?;
    res.backup = Some(ORIGINAL.to_string());
    Ok(res)
}

/// Puts the config from before Ultimate back (the backup stays, it can be restored again).
pub fn restore_file(file: &Path) -> Result<String, String> {
    let bak = backups(file).into_iter().next().ok_or("Aucune sauvegarde d'Ultimate")?;
    let bytes = fs::read(&bak).map_err(|e| e.to_string())?;
    serde_json::from_slice::<Value>(&bytes).map_err(|e| format!("Sauvegarde illisible : {e}"))?;
    write_atomic(file, &bytes)?;
    Ok(ORIGINAL.to_string())
}

/// Is Cyberpunk running? Applying then would be undone: the game rewrites the file when it quits.
pub fn cp2077_running() -> bool {
    crate::win::exe_paths().iter().any(|e| e.ends_with("\\cyberpunk2077.exe"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn doc() -> Value {
        json!({"version": 152, "data": [
            {"group_name": "/graphics/presets", "options": [
                {"name": "ResolutionScaling", "type": "string_list", "is_dynamic": true, "value": "FSR2", "index": 2},
                {"name": "DLSS", "type": "string_list", "is_dynamic": true, "value": "Auto", "index": 0},
                {"name": "TextureQuality", "type": "string_list", "is_dynamic": false, "value": "Low", "index": 0, "default_index": 2, "values": ["Low", "Medium", "High"]}]},
            {"group_name": "/graphics/advanced", "options": [
                {"name": "Anisotropy", "type": "int_list", "value": 4, "index": 1, "values": [1, 4, 8, 16]},
                {"name": "ContactShadows", "type": "bool", "value": false},
                {"name": "FieldOfView", "type": "float", "value": 80.0, "min_value": 70.0, "max_value": 100.0}]},
            {"group_name": "/video/display", "options": [
                {"name": "MaximumFPS_Value", "type": "int", "value": 240, "min_value": 10, "max_value": 240}]}]})
    }

    #[test]
    fn applies_known_valid_values_only() {
        let mut d = doc();
        let v: HashMap<String, Value> = serde_json::from_value(json!({
            "ResolutionScaling": "DLSS", "DLSS": "Quality", "TextureQuality": "High", "Anisotropy": 16, "ContactShadows": true,
            "MaximumFPS_Value": 120, "FieldOfView": 90.0, "Nope": 1})).unwrap();
        let r = cp2077_apply(&mut d, &v);
        assert_eq!(r.skipped, vec!["FieldOfView", "Nope"]);
        assert_eq!(r.changed.len(), 6);
        let f = cp2077_flat(&d);
        assert_eq!(f["DLSS"], "Quality");
        assert_eq!(f["TextureQuality"], "High");
        let opt = |n: &str| d["data"].as_array().unwrap().iter().flat_map(|g| g["options"].as_array().unwrap().clone()).find(|o| o["name"] == n).unwrap();
        assert_eq!(opt("ResolutionScaling")["index"], 1);
        assert_eq!(opt("DLSS")["index"], 2);
        assert_eq!(opt("TextureQuality")["index"], 2);
        assert_eq!(opt("Anisotropy")["index"], 3);
        assert_eq!(f["FieldOfView"], 80.0);
    }

    #[test]
    fn refuses_values_the_game_may_not_accept() {
        let mut d = doc();
        let v: HashMap<String, Value> = serde_json::from_value(json!({
            "ResolutionScaling": "XESS", "TextureQuality": "Ultra", "Anisotropy": 2, "MaximumFPS_Value": 500, "ContactShadows": "yes"})).unwrap();
        let r = cp2077_apply(&mut d, &v);
        assert!(r.changed.is_empty());
        assert_eq!(r.skipped.len(), 5);
        assert_eq!(cp2077_flat(&d), cp2077_flat(&doc()));
    }

    #[test]
    fn same_layout_as_the_game() {
        let src = "{\n    \"version\": 152,\n    \"data\": [\n        {\n            \"b\": 0.1000000014,\n            \"a\": 5.0\n        }\n    ]\n}";
        let v: Value = serde_json::from_str(src).unwrap();
        assert_eq!(String::from_utf8(to_game_json(&v).unwrap()).unwrap(), src);
    }

    /// With ULTIMATE_CP_SAMPLE = a *copy* of a real UserSettings.json: writing it back without
    /// changes gives the exact same bytes (nothing but the asked values ever changes).
    #[test]
    fn real_file_round_trip() {
        let Some(p) = std::env::var_os("ULTIMATE_CP_SAMPLE") else { return };
        let orig = fs::read(p).unwrap();
        let v: Value = serde_json::from_slice(&orig).unwrap();
        assert!(to_game_json(&v).unwrap() == orig, "le format du fichier ne serait pas conservé");
    }

    #[test]
    fn apply_then_restore_in_a_temp_folder() {
        let dir = std::env::temp_dir().join(format!("ultimate-gameconf-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("UserSettings.json");
        let orig = to_game_json(&doc()).unwrap();
        fs::write(&file, &orig).unwrap();
        fs::write(dir.join("UserSettings.json.avant-optimisation.bak"), b"user's own").unwrap();
        let hi: HashMap<String, Value> = serde_json::from_value(json!({"TextureQuality": "High"})).unwrap();
        let med: HashMap<String, Value> = serde_json::from_value(json!({"TextureQuality": "Medium", "Anisotropy": 16})).unwrap();
        let r = apply_file(&file, &hi).unwrap();
        assert_eq!(r.changed, vec!["TextureQuality"]);
        assert_eq!(backups(&file).len(), 1);
        assert_eq!(fs::read(dir.join(r.backup.unwrap())).unwrap(), orig);
        assert_eq!(cp2077_flat(&serde_json::from_slice(&fs::read(&file).unwrap()).unwrap())["TextureQuality"], "High");
        // nothing to change: nothing written
        assert!(apply_file(&file, &hi).unwrap().backup.is_none());
        // a second, different apply in the same second keeps the very first backup
        apply_file(&file, &med).unwrap();
        assert_eq!(backups(&file).len(), 1);
        assert_eq!(fs::read(&backups(&file)[0]).unwrap(), orig);
        // restore always goes back to before Ultimate, and can be done twice
        restore_file(&file).unwrap();
        assert_eq!(fs::read(&file).unwrap(), orig);
        restore_file(&file).unwrap();
        assert_eq!(fs::read(&file).unwrap(), orig);
        assert_eq!(fs::read(dir.join("UserSettings.json.avant-optimisation.bak")).unwrap(), b"user's own");
        let _ = fs::remove_dir_all(&dir);
    }
}
