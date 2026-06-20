use std::{collections::HashMap, future::Future, pin::Pin, sync::Arc};

use ipnet::IpNet;

use crate::{
    builtins::register_builtin_cidr_node_factories,
    config::CustomCidrNodeConfig,
    error::{RealIpError, RealIpResult},
};

pub type CidrNodeLoadFuture<'a> =
    Pin<Box<dyn Future<Output = RealIpResult<Vec<IpNet>>> + Send + 'a>>;

pub trait DynamicCidrNode: Send + Sync {
    fn load<'a>(&'a self) -> CidrNodeLoadFuture<'a>;
}

pub trait CustomCidrNodeFactory: Send + Sync {
    fn kind(&self) -> &'static str;
    fn create(&self, config: &CustomCidrNodeConfig) -> RealIpResult<Arc<dyn DynamicCidrNode>>;
}

#[derive(Default, Clone)]
pub struct CidrNodeFactoryRegistry {
    factories: HashMap<String, Arc<dyn CustomCidrNodeFactory>>,
}

impl CidrNodeFactoryRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_builtin_nodes() -> RealIpResult<Self> {
        let mut registry = Self::new();
        register_builtin_cidr_node_factories(&mut registry)?;
        Ok(registry)
    }

    pub fn register<F>(&mut self, factory: F) -> RealIpResult<()>
    where
        F: CustomCidrNodeFactory + 'static,
    {
        let kind = factory.kind().to_string();
        if self.factories.contains_key(&kind) {
            return Err(RealIpError::DuplicateCidrNodeFactory { kind });
        }
        self.factories.insert(kind, Arc::new(factory));
        Ok(())
    }

    pub fn get(&self, kind: &str) -> Option<Arc<dyn CustomCidrNodeFactory>> {
        self.factories.get(kind).cloned()
    }
}
