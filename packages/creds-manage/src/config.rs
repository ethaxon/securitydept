use serde::Deserialize;

#[derive(Debug, Clone, Deserialize, Default)]
pub struct CredsManageConfig {
    #[serde(default = "default_data_path")]
    pub data_path: String,
    #[cfg(feature = "migration")]
    #[serde(default = "default_auto_migrate")]
    pub auto_migrate: bool,
}

fn default_data_path() -> String {
    "./data/data.json".to_string()
}

#[cfg(feature = "migration")]
fn default_auto_migrate() -> bool {
    true
}
