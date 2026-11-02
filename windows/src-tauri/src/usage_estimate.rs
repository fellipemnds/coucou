//! Estimated Claude plan usage, summed from Claude Code's own session logs
//! (`~/.claude/projects/**/*.jsonl` on Windows and in the running WSL distros),
//! the way ccusage does. For the Claude desktop app, which runs no status line,
//! so the real numbers never reach Coucou. Fork-only file.
//!
//! Each entry is weighed by its API-equivalent cost: the plan limits weigh models
//! differently, and cost is the one measure that does. The island turns it into
//! a percent with the user's own calibration (settings), never by asking anyone.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

use crate::whatsapp::gateway::rfc3339_ms;

const HOUR_MS: i64 = 3_600_000;
const BLOCK_MS: i64 = 5 * HOUR_MS;
/// Kept in memory: one week plus the start of the block that was running then.
const KEEP_MS: i64 = 8 * 24 * HOUR_MS;
/// wsl.exe is asked again for the running distros at most this often.
const ROOTS_MS: i64 = 10 * 60_000;

#[derive(Clone, Copy, Debug, PartialEq)]
struct Entry {
    at: i64,
    cost: f64,
}

#[derive(Default)]
struct Scan {
    /// Bytes already read of each log.
    offsets: HashMap<PathBuf, u64>,
    /// `message.id:requestId`: Claude Code writes one reply on several lines.
    seen: HashSet<String>,
    entries: Vec<Entry>,
    roots: Vec<PathBuf>,
    roots_at: i64,
}

static SCAN: Mutex<Option<Scan>> = Mutex::new(None);

/// US dollars per million input tokens. Output costs 5×, cache writes 1.25×,
/// cache reads 0.1× — Anthropic's API ratios.
/// shortcut: Haiku is exact (checked against ccusage on 2026-11-01), Opus and Sonnet
/// are close; the calibration absorbs the scale. Update when the models change.
fn input_price(model: &str) -> f64 {
    if model.contains("haiku") {
        0.1
    } else if model.contains("sonnet") {
        1.5
    } else {
        2.5
    }
}

/// One log line → the reply's key and entry, when it carries usage.
fn parse_line(line: &str) -> Option<(String, Entry)> {
    if !line.contains("\"usage\"") {
        return None;
    }
    let v: Value = serde_json::from_str(line).ok()?;
    let message = v.get("message")?;
    let usage = message.get("usage")?;
    let model = message.get("model").and_then(Value::as_str).unwrap_or_default();
    if model == "<synthetic>" {
        return None;
    }
    let at = rfc3339_ms(v.get("timestamp").and_then(Value::as_str))?;
    let n = |k: &str| usage.get(k).and_then(Value::as_f64).unwrap_or(0.0);
    let units = n("input_tokens")
        + 5.0 * n("output_tokens")
        + 1.25 * n("cache_creation_input_tokens")
        + 0.1 * n("cache_read_input_tokens");
    let key = format!(
        "{}:{}",
        message.get("id").and_then(Value::as_str).unwrap_or_default(),
        v.get("requestId").and_then(Value::as_str).unwrap_or_default()
    );
    Some((key, Entry { at, cost: units * input_price(model) / 1e6 }))
}

impl Scan {
    /// Reads what was appended to `path` since last time, whole lines only.
    fn read_file(&mut self, path: &Path, since: i64) {
        let Ok(meta) = fs::metadata(path) else { return };
        // Untouched since before `since`: nothing in it counts, so it is not even opened.
        if meta.modified().is_ok_and(|m| epoch_ms(m) < since) {
            return;
        }
        let len = meta.len();
        let mut offset = self.offsets.get(path).copied().unwrap_or(0);
        if offset > len {
            offset = 0; // rewritten
        }
        if offset == len {
            return;
        }
        let Ok(mut file) = fs::File::open(path) else { return };
        let mut buf = Vec::new();
        if file.seek(SeekFrom::Start(offset)).is_err() || file.read_to_end(&mut buf).is_err() {
            return;
        }
        // A line still being written waits for the next read.
        let Some(end) = buf.iter().rposition(|&b| b == b'\n') else { return };
        for line in String::from_utf8_lossy(&buf[..end]).lines() {
            if let Some((key, entry)) = parse_line(line) {
                if entry.at >= since && self.seen.insert(key) {
                    self.entries.push(entry);
                }
            }
        }
        self.offsets.insert(path.to_path_buf(), offset + end as u64 + 1);
    }

    fn read_dir(&mut self, dir: &Path, since: i64) {
        let Ok(items) = fs::read_dir(dir) else { return };
        for item in items.flatten() {
            let path = item.path();
            let Ok(kind) = item.file_type() else { continue };
            if kind.is_dir() {
                self.read_dir(&path, since);
            } else if path.extension().is_some_and(|e| e == "jsonl") {
                self.read_file(&path, since);
            }
        }
    }

    fn refresh(&mut self, now: i64) {
        if self.roots.is_empty() || now - self.roots_at > ROOTS_MS {
            self.roots = roots();
            self.roots_at = now;
        }
        let since = now - KEEP_MS;
        for root in self.roots.clone() {
            self.read_dir(&root, since);
        }
        if self.entries.first().is_some_and(|e| e.at < since) {
            self.entries.retain(|e| e.at >= since);
            // shortcut: `seen` only grows while Coucou runs (a few thousand keys a week); prune it if that ever matters.
        }
        self.entries.sort_by_key(|e| e.at);
    }
}

fn roots() -> Vec<PathBuf> {
    let mut roots = vec![crate::platform::home_dir().join(".claude").join("projects")];
    for distro in crate::wsl::running() {
        if let Some(claude) = distro.settings_path().parent() {
            roots.push(claude.join("projects"));
        }
    }
    roots
}

/// The running 5-hour block, ccusage's rule: it starts on the hour of its first
/// entry and ends 5 hours later; a 5-hour gap also ends it.
fn current_block(entries: &[Entry], now: i64) -> Option<(i64, f64)> {
    let mut block: Option<(i64, f64)> = None;
    let mut last = i64::MIN;
    for e in entries {
        match block.as_mut() {
            Some((start, cost)) if e.at < *start + BLOCK_MS && e.at - last < BLOCK_MS => *cost += e.cost,
            _ => block = Some((e.at - e.at.rem_euclid(HOUR_MS), e.cost)),
        }
        last = e.at;
    }
    block.filter(|(start, _)| now < start + BLOCK_MS && now - last < BLOCK_MS)
}

fn summary(entries: &[Entry], now: i64, week_start: i64) -> Value {
    let week: f64 = entries.iter().filter(|e| e.at >= week_start).map(|e| e.cost).sum();
    json!({
        "fiveHour": current_block(entries, now).map(|(start, cost)| json!({
            "start": start,
            "resetsAt": start + BLOCK_MS,
            "cost": cost,
        })),
        "week": { "start": week_start, "cost": week },
        "updatedAt": now,
    })
}

fn epoch_ms(t: SystemTime) -> i64 {
    t.duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or_default()
}

fn read(week_start: Option<i64>) -> Value {
    let now = epoch_ms(SystemTime::now());
    let mut guard = SCAN.lock().unwrap_or_else(|e| e.into_inner());
    let scan = guard.get_or_insert_with(Scan::default);
    scan.refresh(now);
    summary(&scan.entries, now, week_start.unwrap_or(now - 7 * 24 * HOUR_MS))
}

/// `{ fiveHour: { start, resetsAt, cost } | null, week: { start, cost }, updatedAt }`,
/// costs in API-equivalent US dollars. Off the main thread: the first read goes
/// through every recent log.
#[tauri::command]
pub async fn usage_estimate(week_start: Option<i64>) -> Value {
    tauri::async_runtime::spawn_blocking(move || read(week_start)).await.unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(id: &str, at: &str, model: &str, out: u64, read: u64) -> String {
        json!({
            "timestamp": at,
            "requestId": "req",
            "message": { "id": id, "model": model, "usage": {
                "input_tokens": 10, "output_tokens": out,
                "cache_creation_input_tokens": 0, "cache_read_input_tokens": read,
            }},
        })
        .to_string()
    }

    #[test]
    fn weighs_by_model_and_token_kind() {
        let (key, e) = parse_line(&line("m1", "2026-11-01T20:00:00Z", "claude-haiku-5-5", 1000, 10_000)).unwrap();
        assert_eq!(key, "m1:req");
        // (10 + 5×1000 + 0.1×10 000) × $0.10 / M
        assert!((e.cost - 6010.0 * 0.1 / 1e6).abs() < 1e-12);
        let (_, opus) = parse_line(&line("m2", "2026-11-01T20:00:00Z", "claude-opus-5-5", 1000, 10_000)).unwrap();
        assert!(opus.cost > 20.0 * e.cost);
        assert!(parse_line(r#"{"type":"user","message":{"content":"hi"}}"#).is_none());
        assert!(parse_line(&line("m3", "2026-11-01T20:00:00Z", "<synthetic>", 0, 0)).is_none());
    }

    #[test]
    fn block_starts_on_the_hour_and_ends_after_five_hours_or_a_gap() {
        let h = HOUR_MS;
        let e = |at: i64| Entry { at, cost: 1.0 };
        let entries = [e(10 * h + 1_000), e(12 * h), e(14 * h)];
        assert_eq!(current_block(&entries, 14 * h + 1), Some((10 * h, 3.0)));
        // Past the 5 hours: a new block starts with the next entry.
        let entries = [e(10 * h), e(14 * h), e(15 * h + 30 * 60_000)];
        assert_eq!(current_block(&entries, 16 * h), Some((15 * h, 1.0)));
        // Nothing for 5 hours: no running block.
        assert_eq!(current_block(&[e(10 * h)], 15 * h + 1), None);
        assert_eq!(current_block(&[], 0), None);
    }

    #[test]
    fn reads_only_new_whole_lines_once() {
        let dir = std::env::temp_dir().join(format!("coucou-usage-{}", std::process::id()));
        let sub = dir.join("project");
        fs::create_dir_all(&sub).unwrap();
        let path = sub.join("s.jsonl");
        let a = line("a", "2026-11-01T20:00:00Z", "claude-opus-5-5", 100, 0);
        let b = line("b", "2026-11-01T20:01:00Z", "claude-opus-5-5", 100, 0);
        // The same reply twice, then a line still being written.
        fs::write(&path, format!("{a}\n{a}\n{}", &b[..20])).unwrap();
        let mut scan = Scan::default();
        scan.read_dir(&dir, 0);
        assert_eq!(scan.entries.len(), 1);
        fs::write(&path, format!("{a}\n{a}\n{b}\n")).unwrap();
        scan.read_dir(&dir, 0);
        assert_eq!(scan.entries.len(), 2);
        scan.read_dir(&dir, 0);
        assert_eq!(scan.entries.len(), 2);
        // Rewritten shorter: read again from the start, replies already counted stay once.
        let c = line("c", "2026-11-01T20:02:00Z", "claude-opus-5-5", 100, 0);
        fs::write(&path, format!("{a}
{c}
")).unwrap();
        scan.read_dir(&dir, 0);
        assert_eq!(scan.entries.len(), 3);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn skips_what_is_older_than_since() {
        let dir = std::env::temp_dir().join(format!("coucou-usage-old-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let since = rfc3339_ms(Some("2026-11-01T00:00:00Z")).unwrap();
        // A recent file: only its entries from `since` on count.
        let new = dir.join("new.jsonl");
        let old_line = line("o", "2026-10-31T23:00:00Z", "claude-opus-5-5", 100, 0);
        let new_line = line("n", "2026-11-01T01:00:00Z", "claude-opus-5-5", 100, 0);
        fs::write(&new, format!("{old_line}
{new_line}
")).unwrap();
        // A file untouched since before `since`: never opened, whatever it holds.
        let old = dir.join("old.jsonl");
        fs::write(&old, format!("{}
", line("x", "2026-11-01T02:00:00Z", "claude-opus-5-5", 100, 0))).unwrap();
        let before = UNIX_EPOCH + std::time::Duration::from_millis((since - HOUR_MS) as u64);
        fs::File::options().write(true).open(&old).unwrap().set_modified(before).unwrap();
        let mut scan = Scan::default();
        scan.read_dir(&dir, since);
        assert_eq!(scan.entries.len(), 1);
        assert_eq!(scan.entries[0].at, rfc3339_ms(Some("2026-11-01T01:00:00Z")).unwrap());
        assert!(!scan.offsets.contains_key(&old));
        let _ = fs::remove_dir_all(&dir);
    }
}
