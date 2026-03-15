#[cfg(any(feature = "docker", test))]
use crate::config::CustomProviderConfig;
use crate::{error::RealIpResult, extension::ProviderFactoryRegistry};

#[cfg(feature = "docker")]
mod docker;
#[cfg(feature = "kube")]
mod kube;

pub fn register_builtin_provider_factories(
    _registry: &mut ProviderFactoryRegistry,
) -> RealIpResult<()> {
    #[cfg(feature = "docker")]
    _registry.register(docker::DockerProviderFactory)?;

    #[cfg(feature = "kube")]
    _registry.register(kube::KubeProviderFactory)?;

    Ok(())
}

#[cfg(any(feature = "docker", test))]
fn string_list(config: &CustomProviderConfig, key: &str) -> Vec<String> {
    if let Some(value) = config.extra.get(key) {
        if let Some(items) = value.as_array() {
            return items
                .iter()
                .filter_map(|item| item.as_str())
                .map(str::to_string)
                .collect();
        }
        if let Some(item) = value.as_str() {
            return vec![item.to_string()];
        }
    }
    Vec::new()
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::string_list;
    use crate::config::CustomProviderConfig;

    #[test]
    fn string_list_accepts_array_and_string_values() {
        let mut extra = BTreeMap::new();
        extra.insert("array".to_string(), serde_json::json!(["a", "b"]));
        extra.insert("single".to_string(), serde_json::json!("value"));

        let config = CustomProviderConfig {
            name: "test".to_string(),
            kind: "custom".to_string(),
            refresh: None,
            timeout: None,
            on_refresh_failure: Default::default(),
            max_stale: None,
            extra,
        };

        assert_eq!(string_list(&config, "array"), vec!["a", "b"]);
        assert_eq!(string_list(&config, "single"), vec!["value"]);
        assert!(string_list(&config, "missing").is_empty());
    }
}
