//! Download manager with a bounded-concurrency queue.
//!
//! Browser downloads are intercepted (see `browser::on_download`) and routed
//! here instead of WebView2's immediate native download, so we can queue them
//! and run at most `max_concurrent` at a time (the "batch limit"), with
//! pause/resume/cancel/retry and live progress. Each file is fetched with
//! reqwest into a `.part` file and renamed on completion; pausing keeps the
//! `.part` so a resume can continue with an HTTP Range request.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncWriteExt;

const RUN: u8 = 0;
const PAUSE: u8 = 1;
const CANCEL: u8 = 2;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadItem {
    id: String,
    url: String,
    filename: String,
    path: String,
    /// queued | active | paused | completed | failed | canceled
    status: String,
    received: u64,
    total: u64,
    error: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    id: String,
    received: u64,
    total: u64,
}

struct Inner {
    items: Vec<DownloadItem>,
    /// Control flag per active download (RUN / PAUSE / CANCEL).
    controls: HashMap<String, Arc<AtomicU8>>,
    max_concurrent: usize,
    seq: u64,
}

pub struct Downloads(Arc<Mutex<Inner>>);

impl Downloads {
    pub fn new() -> Self {
        Downloads(Arc::new(Mutex::new(Inner {
            items: Vec::new(),
            controls: HashMap::new(),
            max_concurrent: 3,
            seq: 0,
        })))
    }
}

fn state(app: &AppHandle) -> Arc<Mutex<Inner>> {
    app.state::<Downloads>().0.clone()
}

fn emit_changed(app: &AppHandle, arc: &Arc<Mutex<Inner>>) {
    let items = arc.lock().unwrap().items.clone();
    let _ = app.emit("downloads-changed", items);
}

// ---- filename / path helpers ----

fn sanitize(name: &str) -> String {
    let out: String = name
        .trim()
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\0' => '_',
            _ => c,
        })
        .collect();
    if out.is_empty() {
        "download".into()
    } else {
        out
    }
}

fn hex(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let (Some(h), Some(l)) = (hex(b[i + 1]), hex(b[i + 2])) {
                out.push(h * 16 + l);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn filename_from_url(url: &str) -> String {
    let path = url.split(['?', '#']).next().unwrap_or(url);
    let last = path.rsplit('/').find(|s| !s.is_empty()).unwrap_or("");
    sanitize(&percent_decode(last))
}

fn split_ext(name: &str) -> (String, String) {
    match name.rfind('.') {
        Some(i) if i > 0 && i + 1 < name.len() => (name[..i].to_string(), name[i + 1..].to_string()),
        _ => (name.to_string(), String::new()),
    }
}

/// A path under `dir` that collides with neither an existing file/`.part` nor a
/// path already targeted by another item (appends " (n)" before the extension).
fn unique_path(dir: &Path, filename: &str, items: &[DownloadItem]) -> (String, PathBuf) {
    let taken: HashSet<String> = items.iter().map(|i| i.path.clone()).collect();
    let (stem, ext) = split_ext(filename);
    let mut candidate = filename.to_string();
    let mut n = 1u32;
    loop {
        let p = dir.join(&candidate);
        let p_str = p.to_string_lossy().to_string();
        let part = dir.join(format!("{candidate}.part"));
        if !p.exists() && !part.exists() && !taken.contains(&p_str) {
            return (candidate, p);
        }
        candidate = if ext.is_empty() {
            format!("{stem} ({n})")
        } else {
            format!("{stem} ({n}).{ext}")
        };
        n += 1;
    }
}

// ---- queue ----

/// Add a download to the queue and try to start it. Returns the new id.
pub fn enqueue(app: &AppHandle, url: String, suggested: Option<String>) -> Result<String, String> {
    let dir = app.path().download_dir().map_err(|e| e.to_string())?;
    let _ = std::fs::create_dir_all(&dir);
    let arc = state(app);
    let id;
    {
        let mut inner = arc.lock().unwrap();
        inner.seq += 1;
        id = format!("d{}", inner.seq);
        let base = suggested
            .filter(|s| !s.trim().is_empty())
            .map(|s| sanitize(&s))
            .unwrap_or_else(|| filename_from_url(&url));
        let (filename, path) = unique_path(&dir, &base, &inner.items);
        inner.items.insert(
            0,
            DownloadItem {
                id: id.clone(),
                url,
                filename,
                path: path.to_string_lossy().to_string(),
                status: "queued".into(),
                received: 0,
                total: 0,
                error: String::new(),
            },
        );
    }
    emit_changed(app, &arc);
    pump(app, &arc);
    Ok(id)
}

/// Start queued items (oldest first) until `max_concurrent` are active.
fn pump(app: &AppHandle, arc: &Arc<Mutex<Inner>>) {
    let to_start: Vec<String> = {
        let mut inner = arc.lock().unwrap();
        let max = inner.max_concurrent;
        let mut starts: Vec<String> = Vec::new();
        while inner.controls.len() + starts.len() < max {
            // Items are stored newest-first, so iterate in reverse for FIFO.
            let next = inner
                .items
                .iter()
                .rev()
                .find(|i| i.status == "queued")
                .map(|i| i.id.clone());
            match next {
                Some(id) => {
                    if let Some(it) = inner.items.iter_mut().find(|i| i.id == id) {
                        it.status = "active".into();
                    }
                    starts.push(id);
                }
                None => break,
            }
        }
        for id in &starts {
            inner.controls.insert(id.clone(), Arc::new(AtomicU8::new(RUN)));
        }
        starts
    };
    if to_start.is_empty() {
        return;
    }
    emit_changed(app, arc);
    for id in to_start {
        let app = app.clone();
        let arc = arc.clone();
        tauri::async_runtime::spawn(async move { run_download(app, arc, id).await });
    }
}

enum Outcome {
    Done,
    Paused,
    Canceled,
    Failed(String),
}

async fn run_download(app: AppHandle, arc: Arc<Mutex<Inner>>, id: String) {
    let (url, path, control) = {
        let inner = arc.lock().unwrap();
        let item = match inner.items.iter().find(|i| i.id == id) {
            Some(i) => i,
            None => return,
        };
        let control = match inner.controls.get(&id) {
            Some(c) => c.clone(),
            None => return,
        };
        (item.url.clone(), item.path.clone(), control)
    };
    let part = format!("{path}.part");
    let outcome = download_to_file(&app, &arc, &id, &url, &part, &control).await;

    {
        let mut inner = arc.lock().unwrap();
        inner.controls.remove(&id);
        if let Some(item) = inner.items.iter_mut().find(|i| i.id == id) {
            match &outcome {
                Outcome::Done => {
                    let _ = std::fs::rename(&part, &path);
                    item.status = "completed".into();
                    if item.total == 0 {
                        item.total = item.received;
                    }
                }
                Outcome::Paused => item.status = "paused".into(),
                Outcome::Canceled => {
                    let _ = std::fs::remove_file(&part);
                    item.status = "canceled".into();
                }
                Outcome::Failed(e) => {
                    item.status = "failed".into();
                    item.error = e.clone();
                }
            }
        }
    }
    emit_changed(&app, &arc);
    pump(&app, &arc);
}

async fn download_to_file(
    app: &AppHandle,
    arc: &Arc<Mutex<Inner>>,
    id: &str,
    url: &str,
    part: &str,
    control: &Arc<AtomicU8>,
) -> Outcome {
    let existing = tokio::fs::metadata(part).await.map(|m| m.len()).unwrap_or(0);

    let client = match reqwest::Client::builder().user_agent("riyo-browser/0.1").build() {
        Ok(c) => c,
        Err(e) => return Outcome::Failed(e.to_string()),
    };
    let mut req = client.get(url);
    if existing > 0 {
        req = req.header(reqwest::header::RANGE, format!("bytes={existing}-"));
    }
    let resp = match req.send().await {
        Ok(r) => r,
        Err(e) => return Outcome::Failed(e.to_string()),
    };
    let status = resp.status();
    if !status.is_success() {
        return Outcome::Failed(format!("HTTP {}", status.as_u16()));
    }

    let resuming = status.as_u16() == 206 && existing > 0;
    let body_len = resp.content_length().unwrap_or(0);
    let total = if resuming { existing + body_len } else { body_len };
    let mut received = if resuming { existing } else { 0 };

    {
        let mut inner = arc.lock().unwrap();
        if let Some(it) = inner.items.iter_mut().find(|i| i.id == id) {
            it.total = total;
            it.received = received;
        }
    }

    let file = if resuming {
        tokio::fs::OpenOptions::new().append(true).open(part).await
    } else {
        tokio::fs::File::create(part).await
    };
    let mut file = match file {
        Ok(f) => f,
        Err(e) => return Outcome::Failed(e.to_string()),
    };

    let mut resp = resp;
    let mut last = Instant::now();
    loop {
        match control.load(Ordering::Relaxed) {
            PAUSE => {
                let _ = file.flush().await;
                return Outcome::Paused;
            }
            CANCEL => {
                let _ = file.flush().await;
                return Outcome::Canceled;
            }
            _ => {}
        }
        let chunk = match resp.chunk().await {
            Ok(Some(c)) => c,
            Ok(None) => break,
            Err(e) => return Outcome::Failed(e.to_string()),
        };
        if let Err(e) = file.write_all(&chunk).await {
            return Outcome::Failed(e.to_string());
        }
        received += chunk.len() as u64;
        if last.elapsed() >= Duration::from_millis(200) {
            last = Instant::now();
            {
                let mut inner = arc.lock().unwrap();
                if let Some(it) = inner.items.iter_mut().find(|i| i.id == id) {
                    it.received = received;
                }
            }
            let _ = app.emit(
                "downloads-progress",
                Progress { id: id.to_string(), received, total },
            );
        }
    }
    let _ = file.flush().await;
    let final_total = if total == 0 { received } else { total };
    {
        let mut inner = arc.lock().unwrap();
        if let Some(it) = inner.items.iter_mut().find(|i| i.id == id) {
            it.received = received;
            it.total = final_total;
        }
    }
    let _ = app.emit(
        "downloads-progress",
        Progress { id: id.to_string(), received, total: final_total },
    );
    Outcome::Done
}

// ---- commands ----

#[tauri::command]
pub fn download_enqueue(app: AppHandle, url: String, filename: Option<String>) -> Result<String, String> {
    enqueue(&app, url, filename)
}

#[tauri::command]
pub fn download_list(app: AppHandle) -> Vec<DownloadItem> {
    app.state::<Downloads>().0.lock().unwrap().items.clone()
}

#[tauri::command]
pub fn download_max_concurrent(app: AppHandle) -> usize {
    app.state::<Downloads>().0.lock().unwrap().max_concurrent
}

#[tauri::command]
pub fn download_set_max_concurrent(app: AppHandle, n: usize) {
    let arc = state(&app);
    {
        let mut inner = arc.lock().unwrap();
        inner.max_concurrent = n.clamp(1, 10);
    }
    pump(&app, &arc); // start more if the limit grew
    emit_changed(&app, &arc);
}

#[tauri::command]
pub fn download_pause(app: AppHandle, id: String) {
    let arc = state(&app);
    let mut changed = false;
    {
        let mut inner = arc.lock().unwrap();
        if let Some(ctrl) = inner.controls.get(&id) {
            ctrl.store(PAUSE, Ordering::Relaxed); // active task flips to paused + pumps
        } else if let Some(it) = inner.items.iter_mut().find(|i| i.id == id) {
            if it.status == "queued" {
                it.status = "paused".into();
                changed = true;
            }
        }
    }
    if changed {
        emit_changed(&app, &arc);
    }
}

#[tauri::command]
pub fn download_resume(app: AppHandle, id: String) {
    let arc = state(&app);
    {
        let mut inner = arc.lock().unwrap();
        if let Some(it) = inner.items.iter_mut().find(|i| i.id == id) {
            if it.status == "paused" {
                it.status = "queued".into();
            }
        }
    }
    emit_changed(&app, &arc);
    pump(&app, &arc);
}

#[tauri::command]
pub fn download_retry(app: AppHandle, id: String) {
    let arc = state(&app);
    {
        let mut inner = arc.lock().unwrap();
        if let Some(it) = inner.items.iter_mut().find(|i| i.id == id) {
            if it.status == "failed" || it.status == "canceled" {
                let _ = std::fs::remove_file(format!("{}.part", it.path));
                it.received = 0;
                it.total = 0;
                it.error.clear();
                it.status = "queued".into();
            }
        }
    }
    emit_changed(&app, &arc);
    pump(&app, &arc);
}

#[tauri::command]
pub fn download_cancel(app: AppHandle, id: String) {
    let arc = state(&app);
    let mut changed = false;
    {
        let mut inner = arc.lock().unwrap();
        if let Some(ctrl) = inner.controls.get(&id) {
            ctrl.store(CANCEL, Ordering::Relaxed); // active task cleans up + pumps
        } else if let Some(it) = inner.items.iter_mut().find(|i| i.id == id) {
            if it.status == "queued" || it.status == "paused" {
                let _ = std::fs::remove_file(format!("{}.part", it.path));
                it.status = "canceled".into();
                changed = true;
            }
        }
    }
    if changed {
        emit_changed(&app, &arc);
    }
}

#[tauri::command]
pub fn download_remove(app: AppHandle, id: String) {
    let arc = state(&app);
    {
        let mut inner = arc.lock().unwrap();
        if inner.controls.contains_key(&id) {
            return; // active — cancel it first
        }
        if let Some(it) = inner.items.iter().find(|i| i.id == id) {
            if it.status != "completed" {
                let _ = std::fs::remove_file(format!("{}.part", it.path));
            }
        }
        inner.items.retain(|i| i.id != id);
    }
    emit_changed(&app, &arc);
}

#[tauri::command]
pub fn download_clear_finished(app: AppHandle) {
    let arc = state(&app);
    {
        let mut inner = arc.lock().unwrap();
        for it in &inner.items {
            if it.status == "failed" || it.status == "canceled" {
                let _ = std::fs::remove_file(format!("{}.part", it.path));
            }
        }
        inner
            .items
            .retain(|i| !matches!(i.status.as_str(), "completed" | "failed" | "canceled"));
    }
    emit_changed(&app, &arc);
}

fn path_of(app: &AppHandle, id: &str) -> Option<String> {
    app.state::<Downloads>()
        .0
        .lock()
        .unwrap()
        .items
        .iter()
        .find(|i| i.id == id)
        .map(|i| i.path.clone())
}

#[tauri::command]
pub fn download_open(app: AppHandle, id: String) -> Result<(), String> {
    let path = path_of(&app, &id).ok_or("not found")?;
    open_path(&path)
}

#[tauri::command]
pub fn download_open_folder(app: AppHandle, id: String) -> Result<(), String> {
    let path = path_of(&app, &id).ok_or("not found")?;
    reveal_path(&path)
}

#[cfg(target_os = "windows")]
fn open_path(path: &str) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    std::process::Command::new("cmd")
        .args(["/C", "start", "", path])
        .creation_flags(0x08000000) // CREATE_NO_WINDOW
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "windows")]
fn reveal_path(path: &str) -> Result<(), String> {
    std::process::Command::new("explorer")
        .arg(format!("/select,{path}"))
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "macos")]
fn open_path(path: &str) -> Result<(), String> {
    std::process::Command::new("open").arg(path).spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[cfg(target_os = "macos")]
fn reveal_path(path: &str) -> Result<(), String> {
    std::process::Command::new("open").args(["-R", path]).spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_path(path: &str) -> Result<(), String> {
    std::process::Command::new("xdg-open").arg(path).spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn reveal_path(path: &str) -> Result<(), String> {
    let parent = Path::new(path)
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| ".".into());
    std::process::Command::new("xdg-open").arg(parent).spawn().map(|_| ()).map_err(|e| e.to_string())
}
