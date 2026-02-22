use serde::Deserialize;

#[derive(Debug, Clone, Deserialize, Default)]
pub struct CredsManageConfig {
    #[serde(default = "default_data_path")]
    pub data_path: String,
}

fn default_data_path() -> String {
    "./data/data.json".to_string()
}
