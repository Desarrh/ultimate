//! Win32 helpers: elevated launch (UAC) and a process list that also sees elevated processes.

use std::path::Path;
use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, ERROR_CANCELLED, FILETIME, INVALID_HANDLE_VALUE};
use windows_sys::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
use windows_sys::Win32::System::Threading::{GetProcessTimes, OpenProcess, QueryFullProcessImageNameW, TerminateProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE};
use windows_sys::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_FLAG_NO_UI, SEE_MASK_NOASYNC, SHELLEXECUTEINFOW};
use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

/// Error returned when the user says "No" to the UAC prompt (the front shows a toast).
pub const UAC_REFUSED: &str = "uac-refused";

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Starts `target` (.exe, .lnk, .bat…) with the "runas" verb: Windows shows the UAC prompt.
/// Blocks until the prompt is answered, so call it off the UI thread.
pub fn run_as_admin(target: &str) -> Result<(), String> {
    let (file, params) = admin_command(target);
    let file = wide(&file);
    let params = params.map(|p| wide(&p));
    let verb = wide("runas");
    let dir = Path::new(target).parent().map(|d| wide(&d.to_string_lossy()));
    unsafe {
        // ShellExecute wants COM on the calling thread; failure (already initialised) is harmless
        CoInitializeEx(std::ptr::null(), (COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) as u32);
        let mut info: SHELLEXECUTEINFOW = std::mem::zeroed();
        info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
        info.fMask = SEE_MASK_NOASYNC | SEE_MASK_FLAG_NO_UI;
        info.lpVerb = verb.as_ptr();
        info.lpFile = file.as_ptr();
        info.lpParameters = params.as_ref().map(|p| p.as_ptr()).unwrap_or(std::ptr::null());
        info.lpDirectory = dir.as_ref().map(|d| d.as_ptr()).unwrap_or(std::ptr::null());
        info.nShow = SW_SHOWNORMAL;
        if ShellExecuteExW(&mut info) != 0 {
            return Ok(());
        }
        let err = GetLastError();
        if err == ERROR_CANCELLED {
            Err(UAC_REFUSED.into())
        } else {
            Err(std::io::Error::from_raw_os_error(err as i32).to_string())
        }
    }
}

/// What to start for `target`. An elevated .bat would run from System32 (Windows ignores the working
/// folder for elevated cmd): go through cmd, which first moves to the file's folder.
fn admin_command(target: &str) -> (String, Option<String>) {
    let low = target.to_lowercase();
    if low.ends_with(".bat") || low.ends_with(".cmd") {
        let dir = Path::new(target).parent().map(|d| d.to_string_lossy().to_string()).unwrap_or_default();
        // cmd /c drops the outer quotes, keeping the inner ones
        return ("cmd.exe".into(), Some(format!("/d /c \"cd /d \"{dir}\" && \"{target}\"\"")));
    }
    (target.into(), None)
}

/// (pid, full lower-case path) of every running executable we can name. Unlike sysinfo (which
/// needs PROCESS_VM_READ), PROCESS_QUERY_LIMITED_INFORMATION also works on elevated processes, so a
/// game started as admin is still seen by a non-admin Ultimate.
pub fn processes() -> Vec<(u32, String)> {
    let mut out = Vec::with_capacity(256);
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap == INVALID_HANDLE_VALUE {
            return out;
        }
        let mut e: PROCESSENTRY32W = std::mem::zeroed();
        e.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut ok = Process32FirstW(snap, &mut e) != 0;
        let mut buf = [0u16; 1024];
        while ok {
            if e.th32ProcessID > 4 {
                let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, e.th32ProcessID);
                if !h.is_null() {
                    let mut len = buf.len() as u32;
                    if QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, buf.as_mut_ptr(), &mut len) != 0 {
                        out.push((e.th32ProcessID, String::from_utf16_lossy(&buf[..len as usize]).to_lowercase()));
                    }
                    CloseHandle(h);
                }
            }
            ok = Process32NextW(snap, &mut e) != 0;
        }
        CloseHandle(snap);
    }
    out
}

/// Full lower-case paths of every running executable we can name (see `processes`).
pub fn exe_paths() -> Vec<String> {
    processes().into_iter().map(|(_, p)| p).collect()
}

fn filetime(f: FILETIME) -> std::time::SystemTime {
    // 100 ns ticks since 1601-01-01
    let t = ((f.dwHighDateTime as u64) << 32) | f.dwLowDateTime as u64;
    let unix = t.saturating_sub(116_444_736_000_000_000) / 10;
    std::time::UNIX_EPOCH + std::time::Duration::from_micros(unix)
}

/// When a process started.
pub fn started(pid: u32) -> Option<std::time::SystemTime> {
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if h.is_null() {
            return None;
        }
        let (mut c, mut x, mut k, mut u): (FILETIME, FILETIME, FILETIME, FILETIME) = std::mem::zeroed();
        let ok = GetProcessTimes(h, &mut c, &mut x, &mut k, &mut u) != 0;
        CloseHandle(h);
        ok.then(|| filetime(c))
    }
}

/// Ends the other processes running exactly `exe` that started before `before`. Returns how many.
pub fn kill_older(exe: &std::path::Path, before: std::time::SystemTime) -> usize {
    let me = std::process::id();
    let target = exe.to_string_lossy().to_lowercase();
    let mut n = 0;
    for (pid, path) in processes() {
        if pid == me || path != target || started(pid).map(|t| t >= before).unwrap_or(true) {
            continue;
        }
        unsafe {
            let h = OpenProcess(PROCESS_TERMINATE, 0, pid);
            if !h.is_null() {
                if TerminateProcess(h, 0) != 0 {
                    n += 1;
                }
                CloseHandle(h);
            }
        }
    }
    n
}

#[cfg(test)]
mod tests {
    #[test]
    fn sees_itself() {
        let me = std::env::current_exe().unwrap().to_string_lossy().to_lowercase();
        assert!(super::exe_paths().contains(&me));
        assert!(super::processes().contains(&(std::process::id(), me)));
    }

    #[test]
    fn elevated_bat_runs_from_its_folder() {
        let (f, p) = super::admin_command(r"D:\Jeux\X Y\start.bat");
        assert_eq!(f, "cmd.exe");
        assert_eq!(p.unwrap(), r#"/d /c "cd /d "D:\Jeux\X Y" && "D:\Jeux\X Y\start.bat"""#);
        assert_eq!(super::admin_command(r"D:\Jeux\x.exe"), (r"D:\Jeux\x.exe".to_string(), None));
    }

    #[test]
    fn start_time_is_now_ish() {
        let t = super::started(std::process::id()).unwrap();
        let age = std::time::SystemTime::now().duration_since(t).unwrap();
        assert!(age < std::time::Duration::from_secs(600), "{age:?}");
    }

    #[test]
    fn never_kills_itself_nor_others() {
        // this very exe, started before the epoch: none
        assert_eq!(super::kill_older(&std::env::current_exe().unwrap(), std::time::UNIX_EPOCH), 0);
        // a path nothing runs from
        assert_eq!(super::kill_older(std::path::Path::new(r"C:\nope\ultimate.exe"), std::time::SystemTime::now()), 0);
    }
}
