use std::borrow::Cow;

use serde::Deserialize;
use serde_with::DeserializeAs;

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
