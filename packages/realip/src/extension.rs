use std::{
    collections::HashMap,
    future::Future,
    pin::Pin,
    sync::Arc,
};

use ipnet::IpNet;

use crate::{
    builtins::register_builtin_provider_factories,
    config::CustomProviderConfig,
    error::{RealIpError, RealIpResult},
};

pub type ProviderLoadFuture<'a> = Pin<Box<dyn Future<Output = RealIpResult<Vec<IpNet>>> + Send + 'a>>;

pub trait DynamicProvider: Send + Sync {
    fn load<'a>(&'a self) -> ProviderLoadFuture<'a>;
}

pub trait CustomProviderFactory: Send + Sync {
    fn kind(&self) -> &'static str;
    fn create(&self, config: &CustomProviderConfig) -> RealIpResult<Arc<dyn DynamicProvider>>;
}

#[derive(Default, Clone)]
pub struct ProviderFactoryRegistry {
    factories: HashMap<String, Arc<dyn CustomProviderFactory>>,
}

impl ProviderFactoryRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_builtin_providers() -> RealIpResult<Self> {
        let mut registry = Self::new();
        register_builtin_provider_factories(&mut registry)?;
        Ok(registry)
    }

    pub fn register<F>(&mut self, factory: F) -> RealIpResult<()>
    where
        F: CustomProviderFactory + 'static,
    {
        let kind = factory.kind().to_string();
        if self.factories.contains_key(&kind) {
            return Err(RealIpError::DuplicateProviderFactory { kind });
        }
        self.factories.insert(kind, Arc::new(factory));
        Ok(())
    }

    pub fn get(&self, kind: &str) -> Option<Arc<dyn CustomProviderFactory>> {
        self.factories.get(kind).cloned()
    }
}
