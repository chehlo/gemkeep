#[tauri::command]
pub fn ping() -> Result<String, String> {
    Ok("pong".to_string())
}
