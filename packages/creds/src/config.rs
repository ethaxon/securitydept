use serde::{Deserialize, Serialize};

use crate::{BasicAuthCred, StaticTokenAuthCred};

/// Configuration for Basic Authentication.
#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct BasicAuthCredsConfig<Creds>
where
    Creds: BasicAuthCred + Clone,
{
    /// List of allowed credentials.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub users: Vec<Creds>,
    /// Realm for authentication challenge.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub realm: Option<String>,
}

impl<Creds> BasicAuthCredsConfig<Creds>
where
    Creds: BasicAuthCred + Clone,
{
    /// Validate the configuration.
    pub fn validate(&self) -> Result<(), crate::error::CredsError> {
        Ok(())
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct StaticTokenAuthCredsConfig<Creds>
where
    Creds: StaticTokenAuthCred + Clone,
{
    /// List of allowed credentials.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tokens: Vec<Creds>,
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
