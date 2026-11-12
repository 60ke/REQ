use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Pair {
    pub key: String,
    pub value: String,
    #[serde(default = "yes")]
    pub enabled: bool,
}
fn yes() -> bool { true }

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Auth {
    #[default]
    None,
    Bearer { #[serde(default)] token: String },
    Basic { #[serde(default)] username: String, #[serde(default)] password: String },
    ApiKey {
        #[serde(default)] key: String,
        #[serde(default)] value: String,
        #[serde(default = "header_location")] location: String,
    },
}
fn header_location() -> String { "header".into() }

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum BodyType {
    #[default]
    None,
    Json,
    Text,
    Form,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default = "default_method")]
    pub method: String,
    pub url: String,
    #[serde(default)]
    pub headers: Vec<Pair>,
    #[serde(default)]
    pub query: Vec<Pair>,
    #[serde(default)]
    pub body_type: BodyType,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub auth: Auth,
    #[serde(default = "default_timeout")]
    pub timeout_ms: u64,
    #[serde(default)]
    pub follow_redirects: bool,
}
fn default_method() -> String { "GET".into() }
fn default_timeout() -> u64 { 30_000 }
impl Default for Request {
    fn default() -> Self {
        Self { id: String::new(), name: "Untitled request".into(), method: default_method(),
            url: String::new(), headers: vec![], query: vec![], body_type: BodyType::None,
            body: String::new(), auth: Auth::None, timeout_ms: default_timeout(), follow_redirects: false }
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Response {
    pub request_id: String,
    pub status: u16,
    pub status_text: String,
    pub headers: Vec<Pair>,
    pub body: String,
    pub duration_ms: u64,
    pub size_bytes: usize,
    pub url: String,
    pub truncated: bool,
    pub content_type: String,
}
