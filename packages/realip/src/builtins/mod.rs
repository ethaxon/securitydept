#[cfg(any(feature = "docker", test))]
use crate::config::CustomCidrNodeConfig;
use crate::{error::RealIpResult, extension::CidrNodeFactoryRegistry};

#[cfg(feature = "docker")]
mod docker;
#[cfg(feature = "kube")]
mod kube;

pub fn register_builtin_cidr_node_factories(
    _registry: &mut CidrNodeFactoryRegistry,
) -> RealIpResult<()> {
    #[cfg(feature = "docker")]
    _registry.register(docker::DockerCidrNodeFactory)?;

    #[cfg(feature = "kube")]
    _registry.register(kube::KubeCidrNodeFactory)?;

    Ok(())
}

#[cfg(any(feature = "docker", test))]
fn string_list(config: &CustomCidrNodeConfig, key: &str) -> Vec<String> {
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
    use crate::config::CustomCidrNodeConfig;

    #[test]
    fn string_list_accepts_array_and_string_values() {
        let mut extra = BTreeMap::new();
        extra.insert("array".to_string(), serde_json::json!(["a", "b"]));
        extra.insert("single".to_string(), serde_json::json!("value"));

        let config = CustomCidrNodeConfig {
            name: "test".to_string(),
            priority: 0,
            accepts_from: vec![],
            allow_multiple_unions: false,
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
