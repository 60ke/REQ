use serde_json::Value;
use std::{fs, io::{Read, Write}, path::Path};

pub const MAX_WORKSPACE_BYTES: u64 = 5 * 1024 * 1024;

pub fn is_secret_key(key: &str) -> bool {
    let key = key.to_lowercase().replace(['-', '_', ' '], "");
    matches!(key.as_str(), "authorization" | "proxyauthorization" | "cookie" | "setcookie" | "password" | "passwd" | "secret" | "token" | "apikey" | "accesstoken" | "refreshtoken" | "clientsecret" | "xapikey" | "xauthtoken")
        || key.ends_with("token") || key.ends_with("secret") || key.ends_with("password") || key.ends_with("apikey")
}
fn is_reference(value: &str) -> bool {
    let value = value.trim().strip_prefix("Bearer ").unwrap_or(value.trim());
    value.starts_with("{{") && value.ends_with("}}") && !value[2..value.len()-2].contains(['{', '}'])
}
fn redact(value: &mut Value) -> usize {
    if let Some(text) = value.as_str() {
        if !text.is_empty() && !is_reference(text) { *value = Value::String(String::new()); return 1; }
    }
    0
}
fn scrub_url(value: &mut Value) -> usize {
    let Some(text) = value.as_str() else { return 0; };
    let mut text = text.to_owned();
    let mut count = 0;
    // Strip userinfo without resolving templates: URL parsers reject {{host}},
    // but a templated authority can still contain literal credentials.
    if let Some(scheme_end) = text.find("://") {
        let authority_start = scheme_end + 3;
        let authority_end = text[authority_start..].find(['/', '?', '#']).map(|end| authority_start + end).unwrap_or(text.len());
        if let Some(at) = text[authority_start..authority_end].rfind('@') {
            text = format!("{}{}", &text[..authority_start], &text[authority_start + at + 1..]);
            count += 1;
        }
    }
    if let Some((base, query)) = text.split_once('?') {
        let (query, fragment) = query.split_once('#').map(|(q,f)| (q, format!("#{f}"))).unwrap_or((query, String::new()));
        let query = query.split('&').map(|piece| {
            let (key, raw) = piece.split_once('=').unwrap_or((piece, ""));
            let decoded = url::form_urlencoded::parse(piece.as_bytes()).next();
            if let Some((decoded_key, decoded_value)) = decoded {
                if is_secret_key(&decoded_key) && !raw.is_empty() && !is_reference(&decoded_value) { count += 1; return format!("{key}="); }
            }
            piece.to_owned()
        }).collect::<Vec<_>>().join("&");
        text = format!("{base}?{query}{fragment}");
    }
    if count > 0 { *value = Value::String(text); }
    count
}

/// Defense in depth for the frontend's session-only credential policy.
/// This is not a general DLP system: arbitrary request bodies remain plaintext.
pub fn sanitize(value: &mut Value) -> usize {
    let mut count = 0;
    match value {
        Value::Array(items) => { for item in items { count += sanitize(item); } },
        Value::Object(object) => {
            let secret_row = object.get("secret").and_then(Value::as_bool).unwrap_or(false)
                || object.get("key").and_then(Value::as_str).is_some_and(is_secret_key);
            let api_key = object.get("type").and_then(Value::as_str) == Some("apiKey");
            if secret_row || api_key { if let Some(value) = object.get_mut("value") { count += redact(value); } }
            for (key, value) in object.iter_mut() {
                if matches!(key.as_str(), "token" | "password" | "clientSecret" | "accessToken" | "refreshToken") { count += redact(value); }
                if key == "url" { count += scrub_url(value); }
                count += sanitize(value);
            }
        },
        _ => {},
    }
    count
}

pub fn load(directory: &Path) -> Result<Value, String> {
    let path = directory.join("workspace.json");
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Value::Null),
        Err(_) => return Err("Could not read the local workspace. Check the app data directory permissions.".into()),
    };
    let mut bytes = Vec::new();
    file.take(MAX_WORKSPACE_BYTES + 1).read_to_end(&mut bytes).map_err(|_| "Could not read the local workspace.")?;
    if bytes.len() as u64 > MAX_WORKSPACE_BYTES { return Err("The local workspace exceeds the 5 MiB limit. It has not been overwritten.".into()); }
    let mut value: Value = serde_json::from_slice(&bytes).map_err(|_| "The local workspace is not valid JSON. It has not been overwritten; recover workspace.json from the app data directory.")?;
    // Loading older workspaces must not resurrect credentials accidentally persisted by older versions.
    sanitize(&mut value);
    Ok(value)
}

pub fn save(directory: &Path, mut workspace: Value) -> Result<usize, String> {
    if !workspace.is_object() { return Err("A workspace must be a JSON object.".into()); }
    let redacted = sanitize(&mut workspace);
    let bytes = serde_json::to_vec_pretty(&workspace).map_err(|_| "Could not encode the workspace.")?;
    if bytes.len() as u64 > MAX_WORKSPACE_BYTES { return Err("The workspace exceeds the 5 MiB limit. Remove older history entries and try again.".into()); }
    fs::create_dir_all(directory).map_err(|_| "Could not create the local app data directory.")?;
    #[cfg(unix)] {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(directory, fs::Permissions::from_mode(0o700)).map_err(|_| "Could not protect the local app data directory.")?;
    }
    let mut temporary = tempfile::NamedTempFile::new_in(directory).map_err(|_| "Could not create a temporary workspace file.")?;
    temporary.write_all(&bytes).map_err(|_| "Could not write the local workspace; your previous file is unchanged.")?;
    temporary.as_file().sync_all().map_err(|_| "Could not flush the local workspace; your previous file is unchanged.")?;
    temporary.persist(directory.join("workspace.json")).map_err(|_| "Could not replace the local workspace; your previous file is unchanged.")?;
    Ok(redacted)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn strips_literal_secrets_and_preserves_references() {
        let mut value = json!({"saved":[{"auth":{"type":"bearer","token":"private"},"headers":[{"key":"Authorization","value":"Bearer {{token}}"},{"key":"X-Api-Key","value":"secret"}],"url":"{{baseUrl}}/v1?api_key=private&x=1"}],"environments":[{"variables":[{"key":"TOKEN","value":"private"},{"key":"baseUrl","value":"https://example.com"}]}]});
        assert_eq!(sanitize(&mut value), 4);
        assert_eq!(value["saved"][0]["auth"]["token"], "");
        assert_eq!(value["saved"][0]["headers"][0]["value"], "Bearer {{token}}");
        assert_eq!(value["environments"][0]["variables"][1]["value"], "https://example.com");
        assert_eq!(value["saved"][0]["url"], "{{baseUrl}}/v1?api_key=&x=1");
    }
    #[test]
    fn strips_url_credentials_and_preserves_reference_queries() {
        let mut value = json!({"url":"https://alice:secret@example.com/path?token={{TOKEN}}&api_key=literal"});
        assert_eq!(sanitize(&mut value), 2);
        let url = value["url"].as_str().unwrap();
        assert!(!url.contains("alice")); assert!(!url.contains("secret"));
        assert!(url.contains("token={{TOKEN}}")); assert!(url.contains("api_key=")); assert!(!url.contains("literal"));
        let mut templated = json!({"url":"https://alice:secret@{{HOST}}/path"});
        assert_eq!(sanitize(&mut templated), 1);
        assert_eq!(templated["url"], "https://{{HOST}}/path");
    }
    #[test]
    fn malformed_references_do_not_leak() {
        for value in ["abc{{token}}", "{{token}}-secret", "{{}}literal", "private"] { assert!(!is_reference(value)); }
    }
    #[test]
    fn workspace_roundtrip_is_atomic_and_private() {
        let directory = tempfile::tempdir().unwrap();
        assert_eq!(load(directory.path()).unwrap(), Value::Null);
        save(directory.path(), json!({"version":1,"saved":[]})).unwrap();
        save(directory.path(), json!({"version":1,"saved":[{"name":"Latest"}]})).unwrap();
        assert_eq!(load(directory.path()).unwrap()["saved"][0]["name"], "Latest");
        #[cfg(unix)] {
            use std::os::unix::fs::PermissionsExt;
            let permissions = fs::metadata(directory.path().join("workspace.json")).unwrap().permissions().mode();
            assert_eq!(permissions & 0o777, 0o600);
        }
    }
    #[test]
    fn corrupt_workspaces_are_reported_not_reset() {
        let directory = tempfile::tempdir().unwrap(); fs::write(directory.path().join("workspace.json"), b"not json").unwrap();
        assert!(load(directory.path()).unwrap_err().contains("not valid JSON"));
    }
}
