//! Minimal HTTPS GET proxy for the New Tab page's data (RSS news) that the
//! webview can't fetch directly because those endpoints aren't CORS-enabled.
//! Runs in Rust via reqwest, so it's subject to neither the webview's CORS nor
//! the engine's disabled background networking.
//!
//! Hardened against abuse since the frontend hands it a URL: only https, only an
//! allow-listed set of hosts (so it can't be turned into an open relay / SSRF
//! tool), no redirect following (a 3xx can't bounce it to another host), and the
//! body is read incrementally with a hard size cap so a large or
//! compression-bombed response can't exhaust memory.

const MAX_BYTES: usize = 3_000_000;
/// Hosts the proxy is allowed to fetch (the New Tab news feeds).
const ALLOWED_HOSTS: &[&str] = &["feeds.bbci.co.uk"];

#[tauri::command]
pub async fn http_get_text(url: String) -> Result<String, String> {
    let parsed = reqwest::Url::parse(&url).map_err(|_| "invalid URL".to_string())?;
    if parsed.scheme() != "https" {
        return Err("only https URLs are allowed".into());
    }
    let host = parsed.host_str().unwrap_or("");
    if !ALLOWED_HOSTS.contains(&host) {
        return Err(format!("host not allowed: {host}"));
    }

    let client = reqwest::Client::builder()
        .user_agent("riyo-browser/0.1 (+https://github.com/Riyoway/riyo-browser)")
        .timeout(std::time::Duration::from_secs(12))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;

    let mut resp = client.get(parsed).send().await.map_err(|e| e.to_string())?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("HTTP {}", status.as_u16()));
    }
    if resp.content_length().map_or(false, |len| len > MAX_BYTES as u64) {
        return Err("response too large".into());
    }

    // Read incrementally so we never hold more than the cap in memory, even if
    // the (decompressed) body would otherwise be huge.
    let mut buf: Vec<u8> = Vec::with_capacity(64 * 1024);
    while let Some(chunk) = resp.chunk().await.map_err(|e| e.to_string())? {
        if buf.len() + chunk.len() > MAX_BYTES {
            return Err("response too large".into());
        }
        buf.extend_from_slice(&chunk);
    }
    Ok(String::from_utf8_lossy(&buf).into_owned())
}
