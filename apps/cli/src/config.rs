use std::path::Path;

use figment::{
    Figment,
    providers::{Format, Toml},
};
use securitydept_creds_manage::CredsManageConfig;
use serde::Deserialize;

use crate::error::{CliError, CliResult};

#[derive(Debug, Clone, Deserialize)]
pub struct CliConfig {
    #[serde(default)]
    pub creds_manage: CredsManageConfig,
}

impl CliConfig {
    pub fn load(path: impl AsRef<Path>) -> CliResult<Self> {
        let config: CliConfig = Figment::new()
            .merge(Toml::file(path.as_ref()))
            .extract()
            .map_err(|e| CliError::ConfigLoad {
                message: e.to_string(),
            })?;
        Ok(config)
    }
}
