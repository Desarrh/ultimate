// Fake Vigie for Ultimate's tests: logs each call next to itself (calls.log) and prints canned answers.
#![windows_subsystem = "windows"]
use std::io::Write;

#[used]
static MARK: &str = "VigieCli:avant-jeu VigieCli:apres-jeu VigieCli:etat-dev VigieCli:couper-dev VigieCli:memoire-jeu VigieCli:memoire-jeu-dossier";

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let dir = std::env::current_exe().unwrap().parent().unwrap().to_path_buf();
    let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis();
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(dir.join("calls.log")) {
        let _ = writeln!(f, "{t} {}", args.join(" "));
    }
    let out = match args.first().map(String::as_str) {
        Some("--etat-dev") => r#"{"v":1,"items":[{"kind":"node","label":"npm run dev (Launcher)","pids":[1],"ram_mo":850},{"kind":"wsl","label":"WSL (vmmem)","pids":[2],"ram_mo":3100}],"total_mo":3950}"#.to_string(),
        Some("--couper-dev") => "2 serveurs coupes, WSL arrete, 3,9 Go liberes".into(),
        Some("--avant-jeu") => "2,3 Go liberes".into(),
        Some("--apres-jeu") => "Plan d'alimentation restaure".into(),
        Some("--memoire-jeu") => r#"{"v":1,"connu":true,"nom":"Game.exe","pic_mo":9000,"disponible_mo":7600,"manque_mo":1400}"#.into(),
        _ => std::hint::black_box(MARK).to_string(),
    };
    println!("{out}");

}
