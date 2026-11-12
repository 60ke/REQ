use base64::{engine::general_purpose::STANDARD, Engine};
use futures_util::StreamExt;
use reqwest::{header::{HeaderMap, HeaderName, HeaderValue, AUTHORIZATION, CONTENT_TYPE}, redirect::Policy, Method};
use std::{collections::HashMap, sync::Arc, time::{Duration, Instant}};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;
use crate::{environment::{resolve_request, Environment}, model::{Auth, BodyType, Pair, Request, Response}};

pub const MAX_RESPONSE_BYTES: usize = 10 * 1024 * 1024;
pub const MAX_REQUEST_BYTES: usize = 10 * 1024 * 1024;
const MAX_TIMEOUT_MS: u64 = 300_000;

#[derive(Clone, Default)]
pub struct RequestManager {
    active: Arc<Mutex<HashMap<String, CancellationToken>>>,
}
impl RequestManager {
    pub async fn execute(&self, request: Request, environment: Environment) -> Result<Response, String> {
        if request.id.trim().is_empty() || request.id.len() > 256 { return Err("A request ID between 1 and 256 characters is required.".into()); }
        let token = CancellationToken::new();
        {
            let mut active = self.active.lock().await;
            if active.contains_key(&request.id) { return Err("This request is already running. Cancel it or wait for it to finish.".into()); }
            active.insert(request.id.clone(), token.clone());
        }
        let result = tokio::select! {
            biased;
            _ = token.cancelled() => Err("Request cancelled.".into()),
            result = execute_inner(&request, &environment) => result,
        };
        self.active.lock().await.remove(&request.id);
        result
    }
    pub async fn cancel(&self, request_id: &str) -> bool {
        if let Some(token) = self.active.lock().await.get(request_id) { token.cancel(); true } else { false }
    }
}

fn append_header(headers: &mut HeaderMap, key: &str, value: &str) -> Result<(), String> {
    let name = HeaderName::from_bytes(key.as_bytes()).map_err(|_| "A header name contains invalid characters.")?;
    let value = HeaderValue::from_str(value).map_err(|_| "A header value contains invalid characters (such as a newline).")?;
    headers.append(name, value);
    Ok(())
}

pub(crate) fn prepare(request: &Request, environment: &Environment) -> Result<(Request, url::Url, HeaderMap), String> {
    let request = resolve_request(request, environment)?;
    if request.body.len() > MAX_REQUEST_BYTES { return Err("Request bodies are limited to 10 MiB.".into()); }
    if request.url.len() > 65_536 { return Err("The URL is too long (maximum 64 KiB).".into()); }
    let mut url = url::Url::parse(&request.url).map_err(|_| "Enter a valid absolute HTTP or HTTPS URL.")?;
    if !matches!(url.scheme(), "http" | "https") { return Err("Only HTTP and HTTPS URLs are supported.".into()); }
    if url.host_str().is_none() { return Err("The URL needs a hostname.".into()); }
    if !url.username().is_empty() || url.password().is_some() { return Err("Put URL credentials in the Authorization tab instead of the URL.".into()); }
    url.set_fragment(None);
    if request.query.len() > 1_000 || request.headers.len() > 1_000 { return Err("Requests are limited to 1,000 headers and 1,000 query parameters.".into()); }
    for field in request.query.iter().filter(|p| p.enabled && !p.key.is_empty()) { url.query_pairs_mut().append_pair(&field.key, &field.value); }
    let mut headers = HeaderMap::new();
    let mut header_size = 0usize;
    for field in request.headers.iter().filter(|p| p.enabled && !p.key.is_empty()) {
        header_size += field.key.len() + field.value.len();
        if header_size > 256 * 1024 { return Err("Request headers are limited to 256 KiB.".into()); }
        append_header(&mut headers, &field.key, &field.value)?;
    }
    match &request.auth {
        Auth::None => {},
        Auth::Bearer { token } => {
            headers.remove(AUTHORIZATION);
            append_header(&mut headers, "Authorization", &format!("Bearer {token}"))?;
        },
        Auth::Basic { username, password } => {
            if username.contains(':') { return Err("Basic authentication usernames cannot contain a colon.".into()); }
            let encoded = STANDARD.encode(format!("{username}:{password}"));
            headers.remove(AUTHORIZATION);
            append_header(&mut headers, "Authorization", &format!("Basic {encoded}"))?;
        },
        Auth::ApiKey { key, value, location } if location == "header" => {
            let name = HeaderName::from_bytes(key.as_bytes()).map_err(|_| "The API key header name is invalid.")?;
            headers.remove(&name); append_header(&mut headers, key, value)?;
        },
        Auth::ApiKey { key, value, location } if location == "query" => {
            if key.is_empty() { return Err("The API key parameter name is empty.".into()); }
            url.query_pairs_mut().append_pair(key, value);
        },
        Auth::ApiKey { .. } => return Err("API key location must be header or query.".into()),
    }
    if request.body_type != BodyType::None && !headers.contains_key(CONTENT_TYPE) {
        let value = match request.body_type { BodyType::Json => "application/json", BodyType::Form => "application/x-www-form-urlencoded", _ => "text/plain; charset=utf-8" };
        headers.insert(CONTENT_TYPE, HeaderValue::from_static(value));
    }
    if let Some(value) = headers.get_mut(AUTHORIZATION) { value.set_sensitive(true); }
    Ok((request, url, headers))
}

async fn execute_inner(request: &Request, environment: &Environment) -> Result<Response, String> {
    let started = Instant::now();
    let (request, url, headers) = prepare(request, environment)?;
    let method = Method::from_bytes(request.method.as_bytes()).map_err(|_| "The HTTP method is invalid.")?;
    let timeout_ms = request.timeout_ms.clamp(1, MAX_TIMEOUT_MS);
    // Do not carry arbitrary user-supplied credentials to a different origin.
    // A cross-origin redirect is returned as the original 3xx for inspection.
    let redirects = if request.follow_redirects {
        Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 { return attempt.error("The request exceeded five redirects."); }
            if attempt.previous().first().is_some_and(|first| first.origin() != attempt.url().origin()) { return attempt.stop(); }
            attempt.follow()
        })
    } else { Policy::none() };
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(timeout_ms))
        .connect_timeout(Duration::from_millis(timeout_ms.min(10_000)))
        .redirect(redirects)
        .referer(false)
        .user_agent("Req/0.1.0")
        .build().map_err(|_| "Could not initialize the HTTPS client.")?;
    let mut builder = client.request(method, url).headers(headers);
    if request.body_type != BodyType::None { builder = builder.body(request.body.clone()); }
    let response = builder.send().await.map_err(network_error)?;
    let status = response.status();
    let url = response.url().to_string();
    let content_type = response.headers().get(CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("").to_owned();
    let headers = response.headers().iter().map(|(k,v)| Pair { key: k.to_string(), value: v.to_str().unwrap_or("[non-UTF-8 header]").to_owned(), enabled: true }).collect();
    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();
    let mut truncated = false;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(network_error)?;
        let remaining = MAX_RESPONSE_BYTES.saturating_sub(bytes.len());
        if chunk.len() > remaining { bytes.extend_from_slice(&chunk[..remaining]); truncated = true; break; }
        bytes.extend_from_slice(&chunk);
    }
    Ok(Response {
        request_id: request.id,
        status: status.as_u16(), status_text: status.canonical_reason().unwrap_or("").to_owned(), headers,
        body: String::from_utf8_lossy(&bytes).into_owned(), duration_ms: started.elapsed().as_millis() as u64,
        size_bytes: bytes.len(), url, truncated, content_type,
    })
}
fn network_error(error: reqwest::Error) -> String {
    if error.is_timeout() { "The request timed out. Increase the timeout or check the server.".into() }
    else if error.is_connect() { "Could not connect. Check the hostname, network, and the server's TLS certificate.".into() }
    else { format!("HTTP request failed: {}", error.without_url()) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::{io::{AsyncReadExt, AsyncWriteExt}, net::TcpListener};

    #[test]
    fn rejects_non_http_and_url_credentials() {
        for url in ["file:///etc/passwd", "ftp://example.com", "https://user:pass@example.com"] {
            assert!(prepare(&Request { url: url.into(), ..Request::default() }, &Environment::new()).is_err());
        }
    }
    #[test]
    fn auth_overrides_headers_and_supports_unicode() {
        let req = Request { url: "https://example.com".into(), headers: vec![Pair { key: "Authorization".into(), value: "old".into(), enabled: true }], auth: Auth::Basic { username: "josé".into(), password: "🔑".into() }, ..Request::default() };
        let (_, _, headers) = prepare(&req, &Environment::new()).unwrap();
        assert_eq!(headers.get_all(AUTHORIZATION).iter().count(), 1);
        assert_eq!(headers[AUTHORIZATION].to_str().unwrap(), format!("Basic {}", STANDARD.encode("josé:🔑")));
    }
    #[test]
    fn query_values_are_encoded_and_disabled_rows_are_ignored() {
        let req = Request { url: "https://example.com?x=1".into(), query: vec![Pair { key: "q".into(), value: "a & b".into(), enabled: true }, Pair { key: "unused".into(), value: "bad".into(), enabled: false }], ..Request::default() };
        let (_, url, _) = prepare(&req, &Environment::new()).unwrap();
        assert_eq!(url.as_str(), "https://example.com/?x=1&q=a+%26+b");
    }
    #[test]
    fn rejects_header_injection() {
        let req = Request { url: "https://example.com".into(), headers: vec![Pair { key: "X-Test".into(), value: "good\r\nInjected: yes".into(), enabled: true }], ..Request::default() };
        assert!(prepare(&req, &Environment::new()).is_err());
    }
    async fn server(response: &'static str, delay_ms: u64) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut buf = [0u8; 8192]; let _ = stream.read(&mut buf).await;
            tokio::time::sleep(Duration::from_millis(delay_ms)).await;
            let _ = stream.write_all(response.as_bytes()).await;
        });
        format!("http://{address}")
    }
    #[tokio::test]
    async fn sends_real_http_and_returns_error_statuses_as_responses() {
        let url = server("HTTP/1.1 418 I'm a teapot\r\nContent-Type: application/json\r\nContent-Length: 11\r\nConnection: close\r\n\r\n{\"ok\":true}", 0).await;
        let response = RequestManager::default().execute(Request { id: "real".into(), url, ..Request::default() }, Environment::new()).await.unwrap();
        assert_eq!(response.status, 418); assert_eq!(response.body, "{\"ok\":true}"); assert_eq!(response.size_bytes, 11);
    }
    #[tokio::test]
    async fn cancellation_releases_request_id() {
        let url = server("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n", 500).await;
        let manager = RequestManager::default(); let runner = manager.clone();
        let task = tokio::spawn(async move { runner.execute(Request { id: "cancel".into(), url, ..Request::default() }, Environment::new()).await });
        tokio::time::sleep(Duration::from_millis(25)).await;
        assert!(manager.cancel("cancel").await);
        assert_eq!(task.await.unwrap().unwrap_err(), "Request cancelled.");
        assert!(!manager.cancel("cancel").await);
    }
    #[tokio::test]
    async fn duplicate_ids_are_rejected_until_the_first_finishes() {
        let url = server("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n", 500).await;
        let manager = RequestManager::default(); let runner = manager.clone();
        let request = Request { id: "duplicate".into(), url, ..Request::default() };
        let first = request.clone();
        let task = tokio::spawn(async move { runner.execute(first, Environment::new()).await });
        tokio::time::sleep(Duration::from_millis(25)).await;
        assert!(manager.execute(request, Environment::new()).await.unwrap_err().contains("already running"));
        manager.cancel("duplicate").await; let _ = task.await;
    }
    #[tokio::test]
    async fn cross_origin_redirects_are_not_followed() {
        let url = server("HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:1/should-not-contact\r\nContent-Length: 0\r\nConnection: close\r\n\r\n", 0).await;
        let response = RequestManager::default().execute(Request { id: "redirect".into(), url, follow_redirects: true, auth: Auth::Bearer { token: "private".into() }, ..Request::default() }, Environment::new()).await.unwrap();
        assert_eq!(response.status, 302);
    }
    #[tokio::test]
    async fn honors_timeout() {
        let url = server("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n", 500).await;
        let result = RequestManager::default().execute(Request { id: "timeout".into(), url, timeout_ms: 25, ..Request::default() }, Environment::new()).await;
        assert!(result.unwrap_err().contains("timed out"));
    }
}
