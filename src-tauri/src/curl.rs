//! A deliberately bounded cURL interchange format. This module NEVER executes a shell.
use crate::{environment::{resolve_request, Environment}, model::{Auth, BodyType, Pair, Request}};
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_CURL_BYTES: usize = 1_048_576;

fn pair(key: impl Into<String>, value: impl Into<String>) -> Pair {
    Pair { key: key.into(), value: value.into(), enabled: true }
}
fn is_file_data(data: &str) -> bool { data.starts_with('@') }
fn encode(value: &str) -> String {
    url::form_urlencoded::Serializer::new(String::new()).append_pair("", value).finish()[1..].to_owned()
}

// shlex 1.x emits an empty word for a standalone backslash-newline.
// Remove only unquoted continuations before tokenization. Do not filter empty
// tokens: an explicitly quoted empty argument is meaningful (for example -d '').
fn remove_unquoted_continuations(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    let mut quote = None;
    let mut word_start = true;
    let mut comment = false;
    while let Some(ch) = chars.next() {
        if comment {
            output.push(ch);
            if ch == '\n' { comment = false; word_start = true; }
            continue;
        }
        if let Some(delimiter) = quote {
            output.push(ch);
            if ch == delimiter { quote = None; }
            else if delimiter == '"' && ch == '\\' {
                // Preserve double-quoted escapes for shlex, including newlines.
                if let Some(next) = chars.next() { output.push(next); }
            }
            continue;
        }
        if ch == '\\' {
            if chars.peek() == Some(&'\n') { chars.next(); continue; }
            output.push(ch);
            if let Some(next) = chars.next() { output.push(next); }
            word_start = false;
            continue;
        }
        output.push(ch);
        match ch {
            '\'' | '"' => { quote = Some(ch); word_start = false; },
            '#' if word_start => comment = true,
            ' ' | '\t' | '\n' => word_start = true,
            _ => word_start = false,
        }
    }
    output
}

pub fn import(curl: &str) -> Result<Request, String> {
    if curl.len() > MAX_CURL_BYTES { return Err("cURL input is limited to 1 MiB.".into()); }
    let normalized = remove_unquoted_continuations(curl);
    let tokens = shlex::split(&normalized).ok_or("The cURL command contains an unclosed quote or escape.")?;
    if tokens.first().map(String::as_str) != Some("curl") {
        return Err("Paste one command beginning with curl. Shell commands are never executed.".into());
    }
    let mut req = Request { id: format!("import-{}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos()), name: "Imported request".into(), ..Request::default() };
    let mut explicit_method = None;
    let mut get = false;
    let mut head = false;
    let mut data = Vec::<String>::new();
    let mut json = false;
    let mut positional = false;
    let mut i = 1;
    while i < tokens.len() {
        let token = &tokens[i];
        i += 1;
        if token == "--" && !positional { positional = true; continue; }
        if positional || !token.starts_with('-') {
            if !req.url.is_empty() { return Err("Only one URL is supported per import. Remove shell operators and additional commands.".into()); }
            req.url = token.clone();
            continue;
        }
        // Handle --long=value and the common short-option forms -XPOST, -H'X: y'.
        let (flag, inline) = if token.starts_with("--") {
            if let Some((flag, value)) = token.split_once('=') { (flag, Some(value.to_owned())) } else { (token.as_str(), None) }
        } else if token.len() > 2 && ["-X", "-H", "-d", "-u", "-A", "-e"].iter().any(|f| token.starts_with(f)) {
            (&token[..2], Some(token[2..].to_owned()))
        } else { (token.as_str(), None) };
        let takes_value = matches!(flag, "-X" | "--request" | "-H" | "--header" | "-d" | "--data" | "--data-raw" | "--data-binary" | "--data-urlencode" | "--json" | "-u" | "--user" | "-A" | "--user-agent" | "-e" | "--referer" | "--url" | "--max-time");
        let value = if takes_value {
            if let Some(value) = inline { value } else {
                let value = tokens.get(i).ok_or_else(|| format!("{flag} needs a value."))?.clone(); i += 1; value
            }
        } else {
            if inline.is_some() { return Err(format!("{flag} does not accept a value.")); }
            String::new()
        };
        match flag {
            "-X" | "--request" => explicit_method = Some(value.to_uppercase()),
            "-H" | "--header" => {
                if value.starts_with('@') { return Err("Reading header files is not supported. Paste the header values instead.".into()); }
                let (key, val) = value.split_once(':').ok_or("Headers must use the form 'Name: value'.")?;
                if key.trim().is_empty() { return Err("A header name is empty.".into()); }
                req.headers.push(pair(key.trim(), val.trim_start()));
            }
            "-d" | "--data" | "--data-binary" | "--data-raw" => {
                if flag != "--data-raw" && is_file_data(&value) { return Err("Reading body files is not supported. Paste the body into the editor instead.".into()); }
                data.push(value);
            }
            "--data-urlencode" => {
                let encoded = if let Some((name, content)) = value.split_once('=') {
                    if name.is_empty() { encode(content) } else { format!("{name}={}", encode(content)) }
                } else {
                    if value.contains('@') { return Err("File-based --data-urlencode is not supported.".into()); }
                    encode(&value)
                };
                data.push(encoded);
            }
            "--json" => {
                if is_file_data(&value) { return Err("Reading JSON files is not supported. Paste the JSON body instead.".into()); }
                json = true; data.push(value);
            }
            "-u" | "--user" => {
                let (username, password) = value.split_once(':').ok_or("Use --user 'username:password'; interactive password prompts are unsupported.")?;
                req.auth = Auth::Basic { username: username.into(), password: password.into() };
            }
            "-A" | "--user-agent" => req.headers.push(pair("User-Agent", value)),
            "-e" | "--referer" => req.headers.push(pair("Referer", value)),
            "--url" => {
                if !req.url.is_empty() { return Err("Only one URL is supported per import.".into()); }
                req.url = value;
            }
            "--max-time" => {
                let seconds: f64 = value.parse().map_err(|_| "--max-time must be a number of seconds.")?;
                if !seconds.is_finite() || seconds <= 0.0 || seconds > 300.0 { return Err("--max-time must be greater than zero and at most 300 seconds.".into()); }
                req.timeout_ms = (seconds * 1000.0).ceil() as u64;
            }
            "-G" | "--get" => get = true,
            "-I" | "--head" => head = true,
            "-L" | "--location" => req.follow_redirects = true,
            // Output formatting does not alter an HTTP request. Compression is negotiated by reqwest.
            "--compressed" | "-g" | "--globoff" | "-s" | "--silent" | "-S" | "--show-error" | "-sS" | "-i" | "--include" | "--no-progress-meter" => {},
            "-k" | "--insecure" => return Err("Req always verifies TLS certificates. --insecure is not supported.".into()),
            _ => return Err(format!("Unsupported cURL option: {flag}. Remove it or configure the request manually.")),
        }
    }
    if req.url.is_empty() { return Err("The cURL command has no URL.".into()); }
    if head && !data.is_empty() && !get { return Err("Combining --head and a request body is unsupported.".into()); }
    let has_data = !data.is_empty();
    let body = data.join(if json { "" } else { "&" });
    req.method = explicit_method.unwrap_or_else(|| if head { "HEAD" } else if get || !has_data { "GET" } else { "POST" }.into());
    if get && has_data {
        let (base, fragment) = req.url.split_once('#').map(|(a,b)| (a.to_owned(), Some(b.to_owned()))).unwrap_or((req.url.clone(), None));
        req.url = format!("{}{}{}{}", base, if base.contains('?') { "&" } else { "?" }, body, fragment.map(|f| format!("#{f}")).unwrap_or_default());
    } else if has_data {
        req.body = body;
        let content_type = req.headers.iter().find(|h| h.key.eq_ignore_ascii_case("content-type")).map(|h| h.value.to_ascii_lowercase());
        req.body_type = if json || content_type.as_ref().is_some_and(|v| v.contains("json")) { BodyType::Json }
            else if content_type.as_ref().is_some_and(|v| !v.contains("application/x-www-form-urlencoded")) { BodyType::Text }
            else { BodyType::Form };
        if !req.headers.iter().any(|h| h.key.eq_ignore_ascii_case("content-type")) {
            req.headers.push(pair("Content-Type", if json { "application/json" } else { "application/x-www-form-urlencoded" }));
        }
    }
    if json && !req.headers.iter().any(|h| h.key.eq_ignore_ascii_case("accept")) { req.headers.push(pair("Accept", "application/json")); }
    Ok(req)
}

fn quote(value: &str) -> String { format!("'{}'", value.replace('\'', "'\"'\"'")) }

/// Export resolves the selected environment only on explicit user action.
/// The result can contain credentials; never log it or persist it automatically.
pub fn export(request: &Request, environment: &Environment) -> Result<String, String> {
    let req = resolve_request(request, environment)?;
    let mut url = url::Url::parse(&req.url).map_err(|_| "Enter a valid absolute HTTP or HTTPS URL before exporting.")?;
    if !matches!(url.scheme(), "http" | "https") { return Err("Only HTTP and HTTPS URLs are supported.".into()); }
    for field in req.query.iter().filter(|f| f.enabled && !f.key.is_empty()) { url.query_pairs_mut().append_pair(&field.key, &field.value); }
    let mut parts = vec!["curl".to_owned(), "--request".into(), quote(&req.method), "--url".into(), quote(url.as_str())];
    if req.follow_redirects { parts.push("--location".into()); }
    if req.timeout_ms != 30_000 { parts.extend(["--max-time".into(), format!("{}", req.timeout_ms as f64 / 1000.0)]); }
    let mut headers = req.headers.iter().filter(|h| h.enabled && !h.key.is_empty()).cloned().collect::<Vec<_>>();
    if req.body_type != BodyType::None && !headers.iter().any(|h| h.key.eq_ignore_ascii_case("content-type")) {
        headers.push(pair("Content-Type", match req.body_type { BodyType::Json => "application/json", BodyType::Form => "application/x-www-form-urlencoded", _ => "text/plain" }));
    }
    match req.auth {
        Auth::None => {},
        Auth::Bearer { token } => { headers.retain(|h| !h.key.eq_ignore_ascii_case("authorization")); headers.push(pair("Authorization", format!("Bearer {token}"))); },
        Auth::Basic { username, password } => { headers.retain(|h| !h.key.eq_ignore_ascii_case("authorization")); parts.extend(["--user".into(), quote(&format!("{username}:{password}"))]); },
        Auth::ApiKey { key, value, location } if location == "query" => {
            url.query_pairs_mut().append_pair(&key, &value); parts[4] = quote(url.as_str());
        }
        Auth::ApiKey { key, value, location } if location == "header" => { headers.retain(|h| !h.key.eq_ignore_ascii_case(&key)); headers.push(pair(key, value)); },
        Auth::ApiKey { .. } => return Err("API key location must be header or query.".into()),
    }
    for h in headers { parts.extend(["--header".into(), quote(&format!("{}: {}", h.key, h.value))]); }
    if req.body_type != BodyType::None { parts.extend(["--data-raw".into(), quote(&req.body)]); }
    Ok(parts.join(" "))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn imports_multiline_json_and_authorization() {
        let req = import("curl --url 'https://example.com/v1' \\\n -H 'Authorization: Bearer example' \\\n --json '{\"name\":\"Ada Lovelace\"}'").unwrap();
        assert_eq!(req.method, "POST"); assert_eq!(req.body_type, BodyType::Json);
        assert_eq!(req.body, "{\"name\":\"Ada Lovelace\"}"); assert_eq!(req.headers[0].value, "Bearer example");
    }
    #[test]
    fn continuations_preserve_empty_arguments_and_quoted_body_data() {
        let empty = import("curl https://example.com \\\n --data-raw ''").unwrap();
        assert_eq!(empty.method, "POST");
        assert_eq!(empty.body, "");
        let single = import("curl https://example.com --data-raw 'first\\\nsecond'").unwrap();
        assert_eq!(single.body, "first\\\nsecond");
        let double = import("curl https://example.com --data-raw \"first\\\nsecond\"").unwrap();
        assert_eq!(double.body, "firstsecond");
        let newline = import("curl https://example.com --data-raw 'first\nsecond'").unwrap();
        assert_eq!(newline.body, "first\nsecond");
    }
    #[test]
    fn continuations_preserve_escaping_and_comments() {
        assert_eq!(remove_unquoted_continuations("curl \\\n --url https://example.com"), "curl  --url https://example.com");
        // Two backslashes encode a literal backslash, not a continuation.
        assert_eq!(remove_unquoted_continuations("curl \\\\\n"), "curl \\\\\n");
        let req = import("curl https://example.com # ignored \\\n --data-raw 'body'").unwrap();
        assert_eq!(req.body, "body");
        assert!(import("curl https://example.com \\\n https://other.example").is_err());
        assert!(import("curl https://example.com \\\n ; echo unsafe").is_err());
    }
    #[test]
    fn explicit_method_and_repeated_data_are_preserved() {
        let req = import("curl -XPUT 'https://example.com' -d a=1 --data=b=2").unwrap();
        assert_eq!(req.method, "PUT"); assert_eq!(req.body, "a=1&b=2");
    }
    #[test]
    fn get_data_becomes_query() {
        let req = import("curl -G --data-urlencode 'q=hello world' 'https://example.com?x=1#part'").unwrap();
        assert_eq!(req.method, "GET"); assert_eq!(req.url, "https://example.com?x=1&q=hello+world#part"); assert_eq!(req.body_type, BodyType::None);
    }
    #[test]
    fn never_executes_shell_or_reads_files() {
        assert!(import("curl https://example.com ; rm -rf /").is_err());
        assert!(import("curl https://example.com --data @/etc/passwd").is_err());
        assert!(import("curl https://example.com --insecure").is_err());
        assert!(import("curl https://example.com --proxy http://other").is_err());
    }
    #[test]
    fn rejects_unbalanced_quotes_and_multiple_urls() {
        assert!(import("curl 'https://example.com").is_err());
        assert!(import("curl https://a.example https://b.example").is_err());
    }
    #[test]
    fn export_roundtrips_quotes_and_unicode() {
        let req = Request { url: "https://example.com".into(), method: "POST".into(), body_type: BodyType::Text, body: "O'Reilly 你好".into(), auth: Auth::Basic { username: "josé".into(), password: "p'a:ss".into() }, ..Request::default() };
        let imported = import(&export(&req, &Environment::new()).unwrap()).unwrap();
        assert_eq!(imported.body, req.body); assert_eq!(imported.auth, req.auth);
    }
}
