// Fake game for Ultimate's tests: no window, sleeps 10 min (the test kills it).
#![windows_subsystem = "windows"]
fn main() { std::thread::sleep(std::time::Duration::from_secs(600)); }
