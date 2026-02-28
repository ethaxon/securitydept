use crate::{CredsManageConfig, CredsManageResult, migrations::models::MigratorTrait};

pub mod m2026022900050001_split_data_file_entries;
pub mod models;

pub struct Migrator {
    migrators: Vec<Box<dyn MigratorTrait>>,
}

impl Default for Migrator {
    fn default() -> Self {
        Self {
            migrators: vec![Box::new(
                m2026022900050001_split_data_file_entries::Migrator,
            )],
        }
    }
}

impl Migrator {
    pub fn try_auto_migrate(&self, config: &CredsManageConfig) -> CredsManageResult<()> {
        if config.auto_migrate {
            self.up(config, None)?;
        }
        Ok(())
    }
}

impl MigratorTrait for Migrator {
    fn up(&self, config: &CredsManageConfig, steps: Option<u32>) -> CredsManageResult<()> {
        let max_steps = steps.unwrap_or(self.migrators.len() as u32);
        for m in self.migrators.iter().take(max_steps as usize) {
            m.up(config, steps)?;
        }
        Ok(())
    }
}
