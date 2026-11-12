pub mod curl;
pub mod environment;
pub mod http;
pub mod model;
pub mod storage;

#[cfg(feature = "desktop")]
mod desktop {
    use crate::{curl, environment::Environment, http::RequestManager, model::{Request, Response}, storage};
    use serde_json::{json, Value};
    use std::sync::Mutex;
    use tauri::{Manager, State};

    #[derive(Default)]
    struct StorageLock(Mutex<()>);

    #[tauri::command]
    async fn execute_request(request: Request, environment: Environment, manager: State<'_, RequestManager>) -> Result<Response, String> {
        manager.execute(request, environment).await
    }
    #[tauri::command]
    async fn cancel_request(request_id: String, manager: State<'_, RequestManager>) -> Result<bool, String> {
        Ok(manager.cancel(&request_id).await)
    }
    #[tauri::command]
    fn import_curl(curl: String) -> Result<Request, String> { curl::import(&curl) }
    #[tauri::command]
    fn export_curl(request: Request, environment: Environment) -> Result<String, String> { curl::export(&request, &environment) }
    #[tauri::command]
    fn load_workspace(app: tauri::AppHandle, lock: State<'_, StorageLock>) -> Result<Value, String> {
        let _guard = lock.0.lock().map_err(|_| "The local workspace is busy. Restart Req and try again.")?;
        let directory = app.path().app_data_dir().map_err(|_| "The app data directory is unavailable.")?;
        storage::load(&directory)
    }
    #[tauri::command]
    fn save_workspace(app: tauri::AppHandle, workspace: Value, lock: State<'_, StorageLock>) -> Result<Value, String> {
        let _guard = lock.0.lock().map_err(|_| "The local workspace is busy. Restart Req and try again.")?;
        let directory = app.path().app_data_dir().map_err(|_| "The app data directory is unavailable.")?;
        let redacted = storage::save(&directory, workspace)?;
        Ok(json!({"saved": true, "redactedFields": redacted}))
    }
    #[cfg_attr(mobile, tauri::mobile_entry_point)]
    pub fn run() {
        tauri::Builder::default()
            .manage(RequestManager::default())
            .manage(StorageLock::default())
            .invoke_handler(tauri::generate_handler![execute_request, cancel_request, import_curl, export_curl, load_workspace, save_workspace])
            .run(tauri::generate_context!())
            .expect("Req could not start its desktop runtime");
    }
}
#[cfg(feature = "desktop")]
pub use desktop::run;
