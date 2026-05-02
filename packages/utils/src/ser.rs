use std::borrow::Cow;

use serde::{Deserialize, Serialize};
use serde_with::{DeserializeAs, SerializeAs};

/// Deserializes a string into Vec<T> by splitting on comma and/or whitespace.
/// Used with PickFirst to accept either a delimited string or a sequence
/// (array).
pub struct CommaOrSpaceSeparated<T>(std::marker::PhantomData<T>);

impl<'de, T> DeserializeAs<'de, Vec<T>> for CommaOrSpaceSeparated<T>
where
    T: serde::de::DeserializeOwned,
{
    fn deserialize_as<D>(deserializer: D) -> std::result::Result<Vec<T>, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        s.split(|c: char| c == ',' || c.is_whitespace())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(try_parse_maybe_json_string::<T, D>)
            .collect()
    }
}

impl<T> SerializeAs<Vec<T>> for CommaOrSpaceSeparated<T>
where
    T: Serialize,
{
    fn serialize_as<S>(source: &Vec<T>, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serialize_delimited_vec(source, " ", serializer)
    }
}

pub struct SpaceSeparated<T>(std::marker::PhantomData<T>);

impl<'de, T> DeserializeAs<'de, Vec<T>> for SpaceSeparated<T>
where
    T: serde::de::DeserializeOwned,
{
    fn deserialize_as<D>(deserializer: D) -> std::result::Result<Vec<T>, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        s.split_whitespace()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(try_parse_maybe_json_string::<T, D>)
            .collect()
    }
}

impl<T> SerializeAs<Vec<T>> for SpaceSeparated<T>
where
    T: Serialize,
{
    fn serialize_as<S>(source: &Vec<T>, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serialize_delimited_vec(source, " ", serializer)
    }
}

#[cfg(feature = "config-schema")]
impl<T> serde_with::schemars_1::JsonSchemaAs<Vec<T>> for CommaOrSpaceSeparated<T> {
    fn schema_name() -> Cow<'static, str> {
        Cow::Borrowed("String")
    }

    fn json_schema(generator: &mut schemars::SchemaGenerator) -> schemars::Schema {
        <String as schemars::JsonSchema>::json_schema(generator)
    }
}

#[cfg(feature = "config-schema")]
impl<T> serde_with::schemars_1::JsonSchemaAs<Vec<T>> for SpaceSeparated<T> {
    fn schema_name() -> Cow<'static, str> {
        Cow::Borrowed("String")
    }

    fn json_schema(generator: &mut schemars::SchemaGenerator) -> schemars::Schema {
        <String as schemars::JsonSchema>::json_schema(generator)
    }
}

fn serialize_delimited_vec<T, S>(
    source: &[T],
    delimiter: &str,
    serializer: S,
) -> Result<S::Ok, S::Error>
where
    T: Serialize,
    S: serde::Serializer,
{
    let mut serialized_parts = Vec::with_capacity(source.len());

    for item in source {
        serialized_parts
            .push(serde_json::to_string(item).map_err(<S::Error as serde::ser::Error>::custom)?);
    }

    serializer.serialize_str(&serialized_parts.join(delimiter))
}

fn try_parse_maybe_json_string<'de, T, D>(s: &str) -> std::result::Result<T, D::Error>
where
    T: serde::de::DeserializeOwned,
    D: serde::Deserializer<'de>,
{
    let quoted = if s.starts_with('"') && s.ends_with('"') {
        Cow::Borrowed(s)
    } else {
        Cow::Owned(serde_json::to_string(s).map_err(<D::Error as serde::de::Error>::custom)?)
    };
    serde_json::from_str::<T>(quoted.as_ref()).map_err(<D::Error as serde::de::Error>::custom)
}
