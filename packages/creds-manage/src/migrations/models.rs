use crate::{CredsManageConfig, CredsManageResult};

pub trait MigratorTrait {
    fn up(&self, config: &CredsManageConfig, steps: Option<u32>) -> CredsManageResult<()>;
}
