//! `img://` protocol: serves remote art and local pictures resized to the size actually displayed,
//! cached on disk. Never upscales: an image smaller than the request is served as-is.
//! URLs: http://img.localhost/t?w=300&u=<remote url>   http://img.localhost/f?w=1920&p=<local path>

use std::{fs, path::PathBuf, sync::OnceLock};
use tokio::sync::Semaphore;

static LIMIT: OnceLock<Semaphore> = OnceLock::new();

fn fnv(s: &str) -> u64 {
    s.bytes().fold(0xcbf29ce484222325u64, |h, b| (h ^ b as u64).wrapping_mul(0x100000001b3))
}

fn pct_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'%' if i + 2 < b.len() => {
                if let Ok(v) = u8::from_str_radix(std::str::from_utf8(&b[i + 1..i + 3]).unwrap_or("zz"), 16) {
                    out.push(v);
                    i += 3;
                    continue;
                }
                out.push(b'%');
            }
            b'+' => out.push(b' '),
            c => out.push(c),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn query(uri: &str) -> (String, std::collections::HashMap<String, String>) {
    let no_scheme = uri.splitn(2, "://").nth(1).unwrap_or(uri);
    let path_q = no_scheme.splitn(2, '/').nth(1).unwrap_or("");
    let (path, q) = path_q.split_once('?').unwrap_or((path_q, ""));
    let map = q.split('&').filter_map(|kv| kv.split_once('=')).map(|(k, v)| (k.to_string(), pct_decode(v))).collect();
    (path.to_string(), map)
}

fn mime(b: &[u8]) -> &'static str {
    if b.starts_with(&[0x89, b'P', b'N', b'G']) { "image/png" } else if b.starts_with(b"RIFF") { "image/webp" } else { "image/jpeg" }
}

const PIC_EXT: &[&str] = &["jpg", "jpeg", "png", "webp", "bmp", "gif"];

/// Returns (bytes, mime, status).
pub async fn serve(cache: PathBuf, http: reqwest::Client, uri: String) -> (Vec<u8>, &'static str, u16) {
    let (path, q) = query(&uri);
    let w: u32 = q.get("w").and_then(|v| v.parse().ok()).unwrap_or(0).clamp(0, 3840);
    let (src, remote) = match path.as_str() {
        "t" => (q.get("u").cloned().unwrap_or_default(), true),
        "f" => (q.get("p").cloned().unwrap_or_default(), false),
        _ => return (vec![], "text/plain", 404),
    };
    if src.is_empty() || (remote && !src.starts_with("https://")) {
        return (vec![], "text/plain", 400);
    }
    if !remote {
        let ext = PathBuf::from(&src).extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
        if !PIC_EXT.contains(&ext.as_str()) {
            return (vec![], "text/plain", 403);
        }
    }
    let key = format!("{:016x}_{w}", fnv(&src));
    let _ = fs::create_dir_all(&cache);
    for ext in ["jpg", "png"] {
        if let Ok(b) = fs::read(cache.join(format!("{key}.{ext}"))) {
            return (b, if ext == "png" { "image/png" } else { "image/jpeg" }, 200);
        }
    }
    let _permit = LIMIT.get_or_init(|| Semaphore::new(6)).acquire().await;
    let raw = if remote {
        match http.get(&src).send().await.and_then(|r| r.error_for_status()) {
            Ok(r) => match r.bytes().await { Ok(b) => b.to_vec(), Err(_) => return (vec![], "text/plain", 502) },
            Err(_) => return (vec![], "text/plain", 404),
        }
    } else {
        match fs::read(&src) { Ok(b) => b, Err(_) => return (vec![], "text/plain", 404) }
    };
    let out = tauri::async_runtime::spawn_blocking(move || shrink(raw, w)).await.unwrap_or_default();
    let (bytes, png) = out;
    if bytes.is_empty() {
        return (vec![], "text/plain", 500);
    }
    let _ = fs::write(cache.join(format!("{key}.{}", if png { "png" } else { "jpg" })), &bytes);
    let m = mime(&bytes);
    (bytes, m, 200)
}

/// Resize to `w` px wide (keeps ratio, never upscales). Transparent images stay PNG.
fn shrink(raw: Vec<u8>, w: u32) -> (Vec<u8>, bool) {
    let Ok(img) = image::load_from_memory(&raw) else { return (raw.clone(), mime(&raw) == "image/png") };
    let alpha = img.color().has_alpha();
    let img = if w > 0 && img.width() > w {
        let h = (img.height() as f64 * w as f64 / img.width() as f64).round().max(1.0) as u32;
        img.resize_exact(w, h, image::imageops::FilterType::Triangle)
    } else if !alpha && mime(&raw) == "image/jpeg" {
        return (raw, false); // already small enough: keep original bytes
    } else {
        img
    };
    let mut buf = std::io::Cursor::new(Vec::new());
    if alpha {
        if img.write_to(&mut buf, image::ImageFormat::Png).is_err() { return (vec![], true) }
        (buf.into_inner(), true)
    } else {
        let rgb = img.to_rgb8();
        let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 86);
        if enc.encode_image(&rgb).is_err() { return (vec![], false) }
        (buf.into_inner(), false)
    }
}
