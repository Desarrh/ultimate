//! Win32 helpers: elevated launch (UAC) and a process list that also sees elevated processes.

use std::path::Path;
use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, ERROR_CANCELLED, INVALID_HANDLE_VALUE};
use windows_sys::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
use windows_sys::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION};
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
    let file = wide(target);
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

/// Full lower-case paths of every running executable we can name. Unlike sysinfo (which needs
/// PROCESS_VM_READ), PROCESS_QUERY_LIMITED_INFORMATION also works on elevated processes, so a
/// game started as admin is still seen by a non-admin Ultimate.
pub fn exe_paths() -> Vec<String> {
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
                        out.push(String::from_utf16_lossy(&buf[..len as usize]).to_lowercase());
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

#[cfg(test)]
mod tests {
    #[test]
    fn sees_itself() {
        let me = std::env::current_exe().unwrap().to_string_lossy().to_lowercase();
        assert!(super::exe_paths().contains(&me));
    }
}
