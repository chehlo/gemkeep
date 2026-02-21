use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};

fn default_burst_gap() -> u64 {
    3
}

/// Global app config stored in ~/.gem-keep/config.json
#[derive(Debug, Serialize, Deserialize, Default)]
pub struct Config {
    pub last_opened_slug: Option<String>,
    #[serde(default = "default_burst_gap")]
    pub burst_gap_secs: u64,
}

pub fn gemkeep_home() -> PathBuf {
    dirs::home_dir()
        .expect("home dir must exist")
        .join(".gem-keep")
}

pub fn project_dir(home: &Path, slug: &str) -> PathBuf {
    home.join("projects").join(slug)
}

pub fn create_project_dirs(home: &Path, slug: &str) -> Result<()> {
    std::fs::create_dir_all(project_dir(home, slug).join("cache").join("thumbnails"))?;
    std::fs::create_dir_all(project_dir(home, slug).join("logs"))?;
    Ok(())
}

pub fn read_config(home: &Path) -> Result<Config> {
    let path = home.join("config.json");
    if !path.exists() {
        return Ok(Config::default());
    }
    let text = std::fs::read_to_string(&path)?;
    Ok(serde_json::from_str(&text).unwrap_or_default())
}

pub fn write_config(home: &Path, config: &Config) -> Result<()> {
    std::fs::create_dir_all(home)?;
    let tmp = home.join("config.json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(config)?)?;
    std::fs::rename(&tmp, home.join("config.json"))?;
    Ok(())
}

pub fn list_existing_slugs(home: &Path) -> Vec<String> {
    let projects_dir = home.join("projects");
    if !projects_dir.exists() {
        return vec![];
    }
    std::fs::read_dir(&projects_dir)
        .ok()
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter(|e| e.path().is_dir())
                .filter_map(|e| e.file_name().into_string().ok())
                .collect()
        })
        .unwrap_or_default()
}

pub fn append_operation_log(home: &Path, slug: &str, event: &str) {
    let log_path = project_dir(home, slug).join("logs").join("operation.log");
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)
    {
        let now = chrono::Utc::now().to_rfc3339();
        let _ = writeln!(f, "[{}] {}", now, event);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn temp_home() -> TempDir {
        tempfile::tempdir().unwrap()
    }

    #[test]
    fn test_project_dir_helper() {
        let tmp = temp_home();
        let home = tmp.path();
        let dir = project_dir(home, "my-project");
        assert_eq!(dir, home.join("projects").join("my-project"));
    }

    // Test recursive delete via std::fs::remove_dir_all (simulates delete_project dir cleanup)
    #[test]
    fn test_recursive_delete() {
        let tmp = temp_home();
        let home = tmp.path();
        create_project_dirs(home, "test-proj").unwrap();
        let dir = project_dir(home, "test-proj");
        assert!(dir.exists());
        std::fs::remove_dir_all(&dir).unwrap();
        assert!(!dir.exists(), "dir should be removed recursively");
    }

    #[test]
    fn test_create_project_dirs() {
        let tmp = temp_home();
        let home = tmp.path();
        create_project_dirs(home, "my-project").unwrap();

        assert!(
            home.join("projects")
                .join("my-project")
                .join("cache")
                .join("thumbnails")
                .is_dir(),
            "cache/thumbnails should be created"
        );
        assert!(
            home.join("projects")
                .join("my-project")
                .join("logs")
                .is_dir(),
            "logs dir should be created"
        );
    }

    #[test]
    fn test_read_config_missing_file() {
        let tmp = temp_home();
        let config = read_config(tmp.path()).unwrap();
        assert!(config.last_opened_slug.is_none());
    }

    #[test]
    fn test_write_and_read_config_round_trip() {
        let tmp = temp_home();
        let home = tmp.path();
        let config = Config {
            last_opened_slug: Some("my-project".to_string()),
            ..Config::default()
        };
        write_config(home, &config).unwrap();
        let loaded = read_config(home).unwrap();
        assert_eq!(loaded.last_opened_slug, Some("my-project".to_string()));
    }

    #[test]
    fn test_read_config_malformed_json_no_crash() {
        let tmp = temp_home();
        let home = tmp.path();
        std::fs::create_dir_all(home).unwrap();
        std::fs::write(home.join("config.json"), b"not valid json }{").unwrap();
        // Must not panic; returns default
        let config = read_config(home).unwrap();
        assert!(config.last_opened_slug.is_none());
    }

    #[test]
    fn test_list_existing_slugs() {
        let tmp = temp_home();
        let home = tmp.path();
        let projects_dir = home.join("projects");
        std::fs::create_dir_all(projects_dir.join("iceland-2024")).unwrap();
        std::fs::create_dir_all(projects_dir.join("wedding-2023")).unwrap();
        // Also create a file (should not be returned)
        std::fs::write(projects_dir.join("not-a-dir.txt"), b"x").unwrap();

        let mut slugs = list_existing_slugs(home);
        slugs.sort();
        assert_eq!(slugs, vec!["iceland-2024", "wedding-2023"]);
    }

    #[test]
    fn test_list_existing_slugs_empty() {
        let tmp = temp_home();
        let slugs = list_existing_slugs(tmp.path());
        assert!(slugs.is_empty());
    }

    #[test]
    fn test_append_operation_log() {
        let tmp = temp_home();
        let home = tmp.path();
        // Need the logs dir to exist
        create_project_dirs(home, "test-proj").unwrap();
        append_operation_log(home, "test-proj", "TEST_EVENT key=value");
        let log_path = home
            .join("projects")
            .join("test-proj")
            .join("logs")
            .join("operation.log");
        let content = std::fs::read_to_string(log_path).unwrap();
        assert!(content.contains("TEST_EVENT key=value"));
    }
}
