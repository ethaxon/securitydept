use std::fmt;

use redact::Secret;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

pub const REDACTED_SECRET: &str = "[REDACTED]";

/// Secret-bearing string wrapper that redacts debug/serialization output.
#[cfg_attr(feature = "config-schema", derive(schemars::JsonSchema))]
#[cfg_attr(
    feature = "config-schema",
    schemars(with = "String", extend("format" = "password", "writeOnly" = true))
)]
#[derive(Clone, Default, Eq, PartialEq, Hash)]
pub struct SecretString(Secret<String>);

impl SecretString {
    pub fn new(value: impl Into<String>) -> Self {
        Self(Secret::new(value.into()))
    }

    pub fn expose_secret(&self) -> &str {
        self.0.expose_secret().as_str()
    }

    pub fn into_exposed_secret(self) -> String {
        self.0.expose_secret().clone()
    }
}

impl fmt::Debug for SecretString {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("SecretString(")?;
        formatter.write_str(REDACTED_SECRET)?;
        formatter.write_str(")")
    }
}

impl From<String> for SecretString {
    fn from(value: String) -> Self {
        Self::new(value)
    }
}

impl From<&str> for SecretString {
    fn from(value: &str) -> Self {
        Self::new(value)
    }
}

impl Serialize for SecretString {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(REDACTED_SECRET)
    }
}

impl<'de> Deserialize<'de> for SecretString {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        String::deserialize(deserializer).map(Self::new)
    }
}

pub fn deserialize_optional_secret_string<'de, D>(
    deserializer: D,
) -> Result<Option<SecretString>, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(Option::<String>::deserialize(deserializer)?
        .filter(|value| !value.is_empty())
        .map(SecretString::new))
}

pub fn serialize_exposed_secret_string<S>(
    value: &SecretString,
    serializer: S,
) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    serializer.serialize_str(value.expose_secret())
}

pub fn serialize_exposed_optional_secret_string<S>(
    value: &Option<SecretString>,
    serializer: S,
) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    match value {
        Some(secret) => serializer.serialize_some(secret.expose_secret()),
        None => serializer.serialize_none(),
    }
}

#[cfg(test)]
mod tests {
    use serde::{Deserialize, Serialize};

    use super::{
        REDACTED_SECRET, SecretString, deserialize_optional_secret_string,
        serialize_exposed_secret_string,
    };

    #[test]
    fn deserialize_from_string() {
        let secret: SecretString = serde_json::from_str("\"hunter2\"")
            .expect("secret string should deserialize from a plain string");

        assert_eq!(secret.expose_secret(), "hunter2");
    }

    #[test]
    fn debug_is_redacted() {
        let debug = format!("{:?}", SecretString::new("hunter2"));

        assert!(debug.contains(REDACTED_SECRET));
        assert!(!debug.contains("hunter2"));
    }

    #[test]
    fn serialize_is_redacted() {
        let encoded = serde_json::to_string(&SecretString::new("hunter2"))
            .expect("secret string should serialize");

        assert_eq!(encoded, format!("\"{REDACTED_SECRET}\""));
    }

    #[test]
    fn explicit_expose_secret_returns_raw_value() {
        let secret = SecretString::new("hunter2");

        assert_eq!(secret.expose_secret(), "hunter2");
        assert_eq!(secret.into_exposed_secret(), "hunter2".to_string());
    }

    #[test]
    fn optional_helper_preserves_empty_string_as_none() {
        #[derive(Deserialize)]
        struct Wrapper {
            #[serde(default, deserialize_with = "deserialize_optional_secret_string")]
            secret: Option<SecretString>,
        }

        let wrapper: Wrapper =
            serde_json::from_str(r#"{"secret":""}"#).expect("wrapper should deserialize");

        assert!(wrapper.secret.is_none());
    }

    #[test]
    fn raw_serialize_helper_is_explicit() {
        #[derive(Serialize)]
        struct Wrapper {
            #[serde(serialize_with = "serialize_exposed_secret_string")]
            secret: SecretString,
        }

        let encoded = serde_json::to_string(&Wrapper {
            secret: SecretString::new("hunter2"),
        })
        .expect("wrapper should serialize");

        assert_eq!(encoded, r#"{"secret":"hunter2"}"#);
    }

    #[cfg(feature = "config-schema")]
    #[test]
    fn json_schema_uses_string_password_hint() {
        let rendered = serde_json::to_string(&schemars::schema_for!(SecretString))
            .expect("schema should serialize");

        assert!(rendered.contains("\"type\":\"string\""));
        assert!(rendered.contains("\"format\":\"password\""));
        assert!(rendered.contains("\"writeOnly\":true"));
    }
}
