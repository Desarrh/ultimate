//! What the PC can do, for the recommended game settings: graphics card and its memory, CPU, RAM,
//! main display. Read once at startup in the background (a few ms), cached in `hw.json` so the
//! game page shows it instantly.

use serde::{Deserialize, Serialize};
use windows_sys::Win32::Graphics::Gdi::{EnumDisplaySettingsW, DEVMODEW, ENUM_CURRENT_SETTINGS};
use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
use winreg::{enums::HKEY_LOCAL_MACHINE, RegKey};

#[derive(Serialize, Deserialize, Clone, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Hw {
    pub gpu: String,
    pub vram_mb: u64,
    pub cpu: String,
    pub ram_mb: u64,
    pub width: u32,
    pub height: u32,
    /// current refresh rate of the main display
    pub hz: u32,
}

/// Display adapters class: each subkey (0000, 0001…) is one adapter with its exact memory size.
const GPU_CLASS: &str = r"SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}";

/// The discrete card is the one with the most dedicated memory (skips the integrated GPU).
fn gpu() -> (String, u64) {
    let mut best = (String::new(), 0u64);
    let Ok(class) = RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(GPU_CLASS) else { return best };
    for name in class.enum_keys().flatten().filter(|k| k.chars().all(|c| c.is_ascii_digit())) {
        let Ok(k) = class.open_subkey(&name) else { continue };
        let desc: String = k.get_value("DriverDesc").unwrap_or_default();
        // REG_QWORD on recent drivers (exact beyond 4 GB), REG_DWORD or binary on older ones
        let mem = k.get_value::<u64, _>("HardwareInformation.qwMemorySize").ok()
            .or_else(|| k.get_raw_value("HardwareInformation.MemorySize").ok().map(|v| {
                let mut b = [0u8; 8];
                for (i, x) in v.bytes.iter().take(8).enumerate() { b[i] = *x; }
                u64::from_le_bytes(b)
            }))
            .unwrap_or(0);
        if !desc.is_empty() && mem >= best.1 {
            best = (desc, mem);
        }
    }
    (best.0, best.1 / (1024 * 1024))
}

fn cpu() -> String {
    RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey(r"HARDWARE\DESCRIPTION\System\CentralProcessor\0")
        .and_then(|k| k.get_value::<String, _>("ProcessorNameString"))
        .map(|s| s.split_whitespace().collect::<Vec<_>>().join(" "))
        .unwrap_or_default()
}

fn ram_mb() -> u64 {
    unsafe {
        let mut m: MEMORYSTATUSEX = std::mem::zeroed();
        m.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
        if GlobalMemoryStatusEx(&mut m) != 0 { m.ullTotalPhys / (1024 * 1024) } else { 0 }
    }
}

/// Main display: current mode (resolution and refresh rate).
fn display() -> (u32, u32, u32) {
    unsafe {
        let mut d: DEVMODEW = std::mem::zeroed();
        d.dmSize = std::mem::size_of::<DEVMODEW>() as u16;
        if EnumDisplaySettingsW(std::ptr::null(), ENUM_CURRENT_SETTINGS, &mut d) != 0 {
            (d.dmPelsWidth, d.dmPelsHeight, d.dmDisplayFrequency)
        } else {
            (0, 0, 0)
        }
    }
}

pub fn detect() -> Hw {
    let (gpu, vram_mb) = gpu();
    let (width, height, hz) = display();
    Hw { gpu, vram_mb, cpu: cpu(), ram_mb: ram_mb(), width, height, hz }
}

#[cfg(test)]
mod tests {
    #[test]
    fn detects_this_pc() {
        let h = super::detect();
        assert!(h.ram_mb > 1024, "{h:?}");
        assert!(!h.cpu.is_empty(), "{h:?}");
        assert!(h.width > 0 && h.hz > 0, "{h:?}");
        println!("{h:?}");
    }
}
