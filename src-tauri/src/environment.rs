use std::collections::HashMap;
use crate::model::{Auth, Request};

pub type Environment = HashMap<String, String>;

/// One-pass substitution. Values are never evaluated, recursively expanded, or logged.
pub fn interpolate(input: &str, variables: &Environment) -> Result<String, String> {
    let mut output = String::with_capacity(input.len());
    let mut rest = input;
    while let Some(start) = rest.find("{{") {
        output.push_str(&rest[..start]);
        let tail = &rest[start + 2..];
        let end = tail.find("}}").ok_or("Unclosed environment variable. Use {{variable}}.")?;
        let key = tail[..end].trim();
        if key.is_empty() { return Err("An environment variable name is empty.".into()); }
        let value = variables.get(key).ok_or_else(|| format!("Environment variable '{key}' is not defined."))?;
        output.push_str(value);
        rest = &tail[end + 2..];
    }
    output.push_str(rest);
    Ok(output)
}

pub fn resolve_request(request: &Request, vars: &Environment) -> Result<Request, String> {
    let mut request = request.clone();
    request.url = interpolate(&request.url, vars)?;
    // Disabled fields should not prevent a request from being sent.
    for pair in request.headers.iter_mut().chain(request.query.iter_mut()).filter(|p| p.enabled) {
        pair.key = interpolate(&pair.key, vars)?;
        pair.value = interpolate(&pair.value, vars)?;
    }
    if request.body_type != crate::model::BodyType::None {
        request.body = interpolate(&request.body, vars)?;
    }
    request.auth = match request.auth {
        Auth::None => Auth::None,
        Auth::Bearer { token } => Auth::Bearer { token: interpolate(&token, vars)? },
        Auth::Basic { username, password } => Auth::Basic {
            username: interpolate(&username, vars)?, password: interpolate(&password, vars)?,
        },
        Auth::ApiKey { key, value, location } => Auth::ApiKey {
            key: interpolate(&key, vars)?, value: interpolate(&value, vars)?, location,
        },
    };
    Ok(request)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn substitutes_once_and_preserves_unicode() {
        let vars = Environment::from([("host".into(), "localhost".into()), ("secret".into(), "{{literal}}".into())]);
        assert_eq!(interpolate("https://{{ host }}/你好?token={{secret}}", &vars).unwrap(), "https://localhost/你好?token={{literal}}");
    }
    #[test]
    fn missing_variables_are_errors_not_empty_strings() {
        assert!(interpolate("{{missing}}", &Environment::new()).unwrap_err().contains("missing"));
        assert!(interpolate("{{unfinished", &Environment::new()).is_err());
    }
    #[test]
    fn disabled_fields_are_not_resolved() {
        let req = Request { url: "https://example.com".into(), headers: vec![crate::model::Pair { key: "x".into(), value: "{{unset}}".into(), enabled: false }], ..Request::default() };
        assert!(resolve_request(&req, &Environment::new()).is_ok());
    }
}
