//! Basic Authentication validator.

use std::collections::HashMap;

use crate::{
    BasicAuthCred, StaticTokenAuthCred, StaticTokenAuthCredsConfig,
    config::BasicAuthCredsConfig,
    error::{CredsError, CredsResult},
};

/// Validator for Basic Authentication credentials.
pub trait BasicAuthCredsValidator<Cred>
where
    Cred: BasicAuthCred,
{
    fn get_cred(&self, username: &str) -> CredsResult<Option<&Cred>>;
    fn verify_cred(&self, username: &str, password: &str) -> CredsResult<Option<&Cred>> {
        let Some(cred) = self.get_cred(username)? else {
            return Ok(None);
        };
        if cred.verify_password(password)? {
            Ok(Some(cred))
        } else {
            Ok(None)
        }
    }
    fn realm(&self) -> Option<&str>;
}

pub struct MapBasicAuthCredsValidator<Creds>
where
    Creds: BasicAuthCred + Clone,
{
    pub creds: HashMap<String, Creds>,
    pub realm: Option<String>,
}

impl<Creds> MapBasicAuthCredsValidator<Creds>
where
    Creds: BasicAuthCred + Clone,
{
    /// Create a new validator from configuration.
    pub fn from_config(config: &BasicAuthCredsConfig<Creds>) -> CredsResult<Self> {
        config.validate()?;
        Ok(Self {
            creds: config
                .users
                .iter()
                .map(|creds| (creds.username().to_string(), creds.clone()))
                .collect(),
            realm: config.realm.clone(),
        })
    }
}

impl<Creds> BasicAuthCredsValidator<Creds> for MapBasicAuthCredsValidator<Creds>
where
    Creds: BasicAuthCred + Clone,
{
    fn get_cred(&self, username: &str) -> CredsResult<Option<&Creds>> {
        Ok(self.creds.get(username))
    }

    fn realm(&self) -> Option<&str> {
        self.realm.as_deref()
    }
}

pub trait StaticTokenAuthCredsValidator<Cred>
where
    Cred: StaticTokenAuthCred,
{
    fn get_cred(&self, token: &str) -> CredsResult<Option<&Cred>>;
    fn verify_cred(&self, token: &str) -> CredsResult<Option<&Cred>> {
        let cred = self
            .get_cred(token)?
            .ok_or(CredsError::InvalidStaticTokenCredentials)?;
        cred.verify_token(token)?;
        Ok(Some(cred))
    }
}

pub struct MapStaticTokenAuthCredsValidator<Creds>
where
    Creds: StaticTokenAuthCred + Clone,
{
    pub creds: HashMap<String, Creds>,
}

impl<Creds> MapStaticTokenAuthCredsValidator<Creds>
where
    Creds: StaticTokenAuthCred + Clone,
{
    /// Create a new validator from configuration.
    pub fn from_config(config: &StaticTokenAuthCredsConfig<Creds>) -> CredsResult<Self> {
        config.validate()?;
        Ok(Self {
            creds: config
                .tokens
                .iter()
                .map(|creds| (creds.token_hash().to_string(), creds.clone()))
                .collect(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Argon2BasicAuthCred, BasicAuthCred};

    fn test_config() -> BasicAuthCredsConfig<Argon2BasicAuthCred> {
        BasicAuthCredsConfig {
            users: vec![
                Argon2BasicAuthCred::new("admin".to_string(), "secret123".to_string()).unwrap(),
                Argon2BasicAuthCred::new("user".to_string(), "password".to_string()).unwrap(),
            ],
            realm: Some("Test".to_string()),
        }
    }

    #[test]
    fn test_validate_credentials() -> CredsResult<()> {
        let validator = MapBasicAuthCredsValidator::from_config(&test_config()).unwrap();
        assert!(validator.verify_cred("admin", "secret123")?.is_some());
        assert!(validator.verify_cred("user", "password")?.is_some());
        assert!(validator.verify_cred("admin", "wrong")?.is_none());
        assert!(validator.verify_cred("unknown", "password")?.is_none());
        Ok(())
    }

    #[test]
    fn test_get_display_name() -> CredsResult<()> {
        let validator = MapBasicAuthCredsValidator::from_config(&test_config()).unwrap();
        assert_eq!(
            validator.get_cred("admin")?.map(|c| c.display_name()),
            Some("admin")
        );
        assert_eq!(
            validator.get_cred("user")?.map(|c| c.display_name()),
            Some("user")
        );
        assert!(validator.get_cred("unknown")?.is_none());
        Ok(())
    }
}
