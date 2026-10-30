// Claude Code inside WSL.
//
// Claude Code started in a WSL distro — from a terminal there, or by the Claude
// desktop app on a WSL folder — reads that distro's ~/.claude/settings.json,
// never %USERPROFILE%\.claude, so the hooks hooks.rs installs never fire for
// it. Each running distro becomes one more entry in Settings → Agents, with the
// same steps as every other agent: the exact diff, a click, a dated backup.
//
// The hooks run the same coucou-hook.exe through WSL interop (/mnt/c/…). It is
// still a Windows process, so it reaches Coucou over the named pipe like any
// other. The file is edited from Windows through \\wsl.localhost\<distro>\…,
// with config_file.rs's usual rules.
//
// Only running distros are listed: asking a stopped one for its home folder
// would boot it every time Settings opens. PermissionRequest is left out: how
// the desktop app behaves while the relay waits up to two minutes for an answer
// in the island has not been tried, and a stalled session costs more than an
// approval made in the app.

use std::path::PathBuf;

use serde_json::Value;

use crate::agents::{AgentStatus, Relay};
use crate::config_file::{self, FileEdit, Plan};
use crate::{hooks, settings};

/// Settings → Agents ids for WSL are `wsl:<distro>`.
pub const ID_PREFIX: &str = "wsl:";

/// The hooks a WSL install writes: Claude Code's, without PermissionRequest.
fn events() -> Vec<(&'static str, u64)> {
    hooks::HOOK_EVENTS.iter().copied().filter(|(event, _)| *event != "PermissionRequest").collect()
}

/// A running distro, as far as Coucou needs it.
pub struct Distro {
    pub name: String,
    /// `$HOME` inside the distro, e.g. `/home/me`.
    pub home: String,
    /// coucou-hook.exe as the distro sees it, e.g. `/mnt/c/Users/me/…/coucou-hook.exe`.
    pub relay: String,
}

impl Distro {
    /// Claude Code's settings in this distro, as Windows reaches them.
    pub fn settings_path(&self) -> PathBuf {
        unc_path(&self.name, &format!("{}/.claude/settings.json", self.home.trim_end_matches('/')))
    }

    fn edits(&self, install: bool) -> Vec<FileEdit<'static>> {
        let relay = Relay { exe: self.relay.clone(), windows: false };
        let label = self.settings_path().display().to_string();
        let change = move |current: &Value| {
            if install {
                let command = |event: &str| relay.command(crate::agents::Shell::Sh, event);
                hooks::merged_with(current, &events(), &command).map(Some)
            } else {
                hooks::without_ours(current).map(Some)
            }
        };
        vec![FileEdit { path: self.settings_path(), edit: config_file::json_edit(label, change) }]
    }

    fn installed(&self) -> bool {
        config_file::read(&self.settings_path())
            .ok()
            .flatten()
            .and_then(|b| config_file::parse_json(Some(&b), "").ok())
            .is_some_and(|v| hooks::has_ours(&v))
    }

    fn status(&self, hook_ready: bool) -> AgentStatus {
        AgentStatus {
            id: format!("{ID_PREFIX}{}", self.name),
            // "Claude Code" and "WSL" are names, not translated.
            name: format!("Claude Code (WSL · {})", self.name),
            installed: self.installed(),
            path: self.settings_path().display().to_string(),
            hook_ready,
            approvals: false,
            note: crate::i18n::t("Start a new Claude Code session in WSL to pick the hooks up."),
        }
    }
}

/// `\\wsl.localhost\<distro>` followed by a Linux absolute path.
fn unc_path(distro: &str, linux: &str) -> PathBuf {
    let mut path = format!(r"\\wsl.localhost\{distro}");
    for part in linux.split('/').filter(|p| !p.is_empty()) {
        path.push('\\');
        path.push_str(part);
    }
    PathBuf::from(path)
}

/// Distro names from `wsl.exe --list --quiet`, which writes UTF-16LE (UTF-8 when
/// `WSL_UTF8=1` is honoured). Docker's and Rancher's own distros run their
/// engines, never Claude Code, and are left out.
pub fn parse_list(bytes: &[u8]) -> Vec<String> {
    let text = if bytes.len() >= 2 && bytes.len() % 2 == 0 && bytes.iter().skip(1).step_by(2).all(|&b| b == 0) {
        let units: Vec<u16> = bytes.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
        String::from_utf16_lossy(&units)
    } else {
        String::from_utf8_lossy(bytes).into_owned()
    };
    text.lines()
        .map(|l| l.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}' || c == '\0').to_string())
        .filter(|name| !name.is_empty())
        .filter(|name| !name.starts_with("docker-desktop") && !name.starts_with("rancher-desktop"))
        .collect()
}

/// The two lines the probe prints: `$HOME`, then the relay's Linux path.
fn parse_probe(stdout: &str) -> Option<(String, String)> {
    let mut lines = stdout.lines().map(str::trim).filter(|l| !l.is_empty());
    let home = lines.next()?;
    let relay = lines.next()?;
    (home.starts_with('/') && relay.starts_with('/')).then(|| (home.to_string(), relay.to_string()))
}

// ── Asking wsl.exe ────────────────────────────────────────────────────────────

#[cfg(windows)]
mod probe {
    use std::io::Read;
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};

    /// Long enough for a running distro, short enough that a stuck wsl.exe
    /// never holds Settings up.
    const TIMEOUT: Duration = Duration::from_secs(4);

    /// `wsl.exe args…`'s stdout when it exits successfully in time.
    pub fn wsl(args: &[&str]) -> Option<Vec<u8>> {
        let mut cmd = Command::new("wsl.exe");
        cmd.args(args).env("WSL_UTF8", "1").stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
        let mut child = crate::platform::no_console(&mut cmd).spawn().ok()?;
        let deadline = Instant::now() + TIMEOUT;
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(20)),
                _ => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return None;
                }
            }
        };
        let mut out = Vec::new();
        child.stdout.take()?.read_to_end(&mut out).ok()?;
        status.success().then_some(out)
    }
}

#[cfg(windows)]
pub fn running() -> Vec<Distro> {
    let Some(list) = probe::wsl(&["--list", "--running", "--quiet"]) else { return Vec::new() };
    let relay = settings::hook_exe_path().to_string_lossy().to_string();
    parse_list(&list)
        .into_iter()
        .filter_map(|name| {
            let out = probe::wsl(&[
                "-d", &name, "--exec", "sh", "-c", r#"printf '%s\n' "$HOME"; wslpath -u "$1""#, "sh", &relay,
            ])?;
            let (home, relay) = parse_probe(&String::from_utf8_lossy(&out))?;
            Some(Distro { name, home, relay })
        })
        .collect()
}

/// There is no WSL outside Windows.
#[cfg(not(windows))]
pub fn running() -> Vec<Distro> {
    Vec::new()
}

// ── Public API, called through agents.rs ──────────────────────────────────────

pub fn list() -> Vec<AgentStatus> {
    let hook_ready = settings::hook_exe_path().exists();
    running().iter().map(|d| d.status(hook_ready)).collect()
}

fn find(id: &str) -> Result<Distro, String> {
    let name = id.strip_prefix(ID_PREFIX).unwrap_or(id);
    running().into_iter().find(|d| d.name == name).ok_or_else(|| {
        crate::i18n::tf("Unknown agent \"{id}\".", &[("id", id)])
    })
}

pub fn preview(id: &str, install: bool) -> Result<Plan, String> {
    config_file::preview(&find(id)?.edits(install))
}

/// Only ever called from an explicit click. Returns the backups taken, one per line.
pub fn apply(id: &str, install: bool, fingerprint: &str) -> Result<String, String> {
    let backups = config_file::apply(&find(id)?.edits(install), fingerprint)?;
    Ok(backups.iter().map(|p| p.display().to_string()).collect::<Vec<_>>().join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn ubuntu() -> Distro {
        Distro {
            name: "Ubuntu".into(),
            home: "/home/me".into(),
            relay: "/mnt/c/Users/me/AppData/Local/Coucou/bin/coucou-hook.exe".into(),
        }
    }

    #[test]
    fn the_list_reads_utf16_and_utf8_and_skips_docker() {
        let utf16: Vec<u8> = "Ubuntu\r\ndocker-desktop\r\nDebian\r\n"
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect();
        assert_eq!(parse_list(&utf16), ["Ubuntu", "Debian"]);
        assert_eq!(parse_list(b"Ubuntu-24.04\n\nrancher-desktop\n"), ["Ubuntu-24.04"]);
        assert!(parse_list(b"").is_empty());
    }

    #[test]
    fn the_probe_needs_two_absolute_paths() {
        assert_eq!(
            parse_probe("/home/me\n/mnt/c/x/coucou-hook.exe\n"),
            Some(("/home/me".into(), "/mnt/c/x/coucou-hook.exe".into()))
        );
        assert_eq!(parse_probe("/home/me\n"), None);
        assert_eq!(parse_probe("wslpath: C:\\x: No such file\n/home/me\n"), None);
    }

    #[test]
    fn the_settings_are_reached_through_wsl_localhost() {
        assert_eq!(ubuntu().settings_path(), PathBuf::from(r"\\wsl.localhost\Ubuntu\home\me\.claude\settings.json"));
        let root = Distro { home: "/root/".into(), ..ubuntu() };
        assert_eq!(root.settings_path(), PathBuf::from(r"\\wsl.localhost\Ubuntu\root\.claude\settings.json"));
    }

    #[test]
    fn installing_runs_the_relay_through_its_linux_path_without_permission_requests() {
        let distro = ubuntu();
        let existing = json!({ "enabledPlugins": { "a@b": true } });
        let change = (distro.edits(true)[0].edit)(Some(existing.to_string().as_bytes())).unwrap();
        let after: Value = serde_json::from_str(&change.after.unwrap()).unwrap();

        assert_eq!(after["enabledPlugins"], existing["enabledPlugins"]);
        assert_eq!(
            after["hooks"]["SessionStart"][0]["hooks"][0]["command"],
            "'/mnt/c/Users/me/AppData/Local/Coucou/bin/coucou-hook.exe' SessionStart"
        );
        assert!(after["hooks"].get("PermissionRequest").is_none());
        assert_eq!(after["hooks"].as_object().unwrap().len(), hooks::HOOK_EVENTS.len() - 1);
        assert!(hooks::has_ours(&after));

        // Removing takes back exactly what was added.
        let removed = (distro.edits(false)[0].edit)(Some(after.to_string().as_bytes())).unwrap();
        let back: Value = serde_json::from_str(&removed.after.unwrap()).unwrap();
        assert_eq!(back, existing);
    }
}
