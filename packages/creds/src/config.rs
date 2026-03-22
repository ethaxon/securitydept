use serde::{Deserialize, Serialize};

use crate::{BasicAuthCred, StaticTokenAuthCred};

/// Configuration for Basic Authentication.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct BasicAuthCredsConfig<Creds>
where
    Creds: BasicAuthCred,
{
    /// List of allowed credentials.
    #[serde(default = "Vec::new", skip_serializing_if = "Vec::is_empty")]
    pub users: Vec<Creds>,
}

impl<Creds> Default for BasicAuthCredsConfig<Creds>
where
    Creds: BasicAuthCred,
{
    fn default() -> Self {
        Self { users: Vec::new() }
    }
}

impl<Creds> BasicAuthCredsConfig<Creds>
where
    Creds: BasicAuthCred,
{
    /// Validate the configuration.
    pub fn validate(&self) -> Result<(), crate::error::CredsError> {
        Ok(())
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct StaticTokenAuthCredsConfig<Creds>
where
    Creds: StaticTokenAuthCred + Clone,
{
    /// List of allowed credentials.
    #[serde(default = "Vec::new", skip_serializing_if = "Vec::is_empty")]
    pub tokens: Vec<Creds>,
}

impl<Creds> Default for StaticTokenAuthCredsConfig<Creds>
where
    Creds: StaticTokenAuthCred + Clone,
{
    fn default() -> Self {
        Self { tokens: Vec::new() }
    }
}

impl<Creds> StaticTokenAuthCredsConfig<Creds>
where
    Creds: StaticTokenAuthCred + Clone,
{
    /// Validate the configuration.
    pub fn validate(&self) -> Result<(), crate::error::CredsError> {
        Ok(())
    }
}
