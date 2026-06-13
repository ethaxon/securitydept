use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
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

impl Default for CredsManageConfig {
    fn default() -> Self {
        Self {
            data_path: default_data_path(),
            #[cfg(feature = "migration")]
            auto_migrate: default_auto_migrate(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rust_default_matches_deserialization_defaults() {
        let config = CredsManageConfig::default();

        assert_eq!(config.data_path, "./data/data.json");
        #[cfg(feature = "migration")]
        assert!(config.auto_migrate);
    }
}
