mod config;
mod error;

use clap::{Parser, Subcommand};
use securitydept_creds_manage::{
    migrations::{Migrator, models::MigratorTrait},
    models::{AuthEntry, AuthEntryKind, Group},
    store::CredsManageStore,
};
use tabled::{Table, Tabled};
use tracing_subscriber::EnvFilter;

use crate::{config::CliConfig, error::CliResult};

#[derive(Parser)]
#[command(name = "securitydept-cli", about = "SecurityDept management CLI")]
struct Cli {
    /// Path to config file
    #[arg(short, long, default_value = "config.toml")]
    config: String,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Manage auth entries
    Entry {
        #[command(subcommand)]
        action: EntryAction,
    },
    /// Manage groups
    Group {
        #[command(subcommand)]
        action: GroupAction,
    },
    /// Manage data file migrations
    Migrate {
        #[command(subcommand)]
        action: MigrateAction,
    },
}

#[derive(Subcommand)]
enum EntryAction {
    /// List all auth entries
    List,
    /// Get an auth entry by id
    Get {
        #[arg(long)]
        id: String,
    },
    /// Create a new basic auth entry
    CreateBasic {
        #[arg(long)]
        name: String,
        #[arg(long)]
        username: String,
        #[arg(long)]
        password: String,
        /// Comma-separated group IDs
        #[arg(long, value_delimiter = ',')]
        group_ids: Vec<String>,
    },
    /// Create a new token auth entry
    CreateToken {
        #[arg(long)]
        name: String,
        /// Comma-separated group IDs
        #[arg(long, value_delimiter = ',')]
        group_ids: Vec<String>,
    },
    /// Delete an auth entry
    Delete {
        #[arg(long)]
        id: String,
    },
    /// Update an auth entry
    Update {
        #[arg(long)]
        id: String,
        #[arg(long)]
        name: Option<String>,
        #[arg(long)]
        username: Option<String>,
        #[arg(long)]
        password: Option<String>,
        /// Comma-separated group IDs
        #[arg(long, value_delimiter = ',')]
        group_ids: Option<Vec<String>>,
    },
}

#[derive(Subcommand)]
enum GroupAction {
    /// List all groups
    List,
    /// Get a group by id
    Get {
        #[arg(long)]
        id: String,
    },
    /// Create a new group
    Create {
        #[arg(long)]
        name: String,
        /// Comma-separated auth entry IDs to bind with this group
        #[arg(long, value_delimiter = ',')]
        entry_ids: Option<Vec<String>>,
    },
    /// Update a group
    Update {
        #[arg(long)]
        id: String,
        #[arg(long)]
        name: String,
        /// Comma-separated auth entry IDs to bind with this group
        #[arg(long, value_delimiter = ',')]
        entry_ids: Option<Vec<String>>,
    },
    /// Delete a group
    Delete {
        #[arg(long)]
        id: String,
    },
}

#[derive(Subcommand)]
enum MigrateAction {
    /// Apply forward migrations.
    Up {
        /// Optional number of migration steps to apply.
        #[arg(long)]
        steps: Option<u32>,
    },
}

// Display structs for tabled output

#[derive(Tabled)]
struct EntryRow {
    #[tabled(rename = "ID")]
    id: String,
    #[tabled(rename = "Name")]
    name: String,
    #[tabled(rename = "Kind")]
    kind: String,
    #[tabled(rename = "Username")]
    username: String,
    #[tabled(rename = "Group IDs")]
    group_ids: String,
    #[tabled(rename = "Created")]
    created_at: String,
}

impl From<AuthEntry> for EntryRow {
    fn from(e: AuthEntry) -> Self {
        Self {
            id: e.meta.id,
            name: e.meta.name,
            kind: match e.kind {
                AuthEntryKind::Basic => "basic".to_string(),
                AuthEntryKind::Token => "token".to_string(),
            },
            username: e.username.unwrap_or_default(),
            group_ids: e.meta.group_ids.join(", "),
            created_at: e.meta.created_at.format("%Y-%m-%d %H:%M").to_string(),
        }
    }
}

#[derive(Tabled)]
struct GroupRow {
    #[tabled(rename = "ID")]
    id: String,
    #[tabled(rename = "Name")]
    name: String,
}

impl From<Group> for GroupRow {
    fn from(g: Group) -> Self {
        Self {
            id: g.id,
            name: g.name,
        }
    }
}

#[tokio::main]
async fn main() -> CliResult<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("warn".parse().unwrap()))
        .init();

    let cli = Cli::parse();
    let config = CliConfig::load(&cli.config)?;

    let migrator = Migrator::default();
    migrator.try_auto_migrate(&config.creds_manage)?;

    if let Commands::Migrate { action } = &cli.command {
        match action {
            MigrateAction::Up { steps } => {
                migrator.up(&config.creds_manage, *steps)?;
                println!(
                    "Migration completed: data file {}",
                    config.creds_manage.data_path
                );
            }
        }
        return Ok(());
    }

    let store = CredsManageStore::load(&config.creds_manage.data_path).await?;

    match cli.command {
        Commands::Entry { action } => match action {
            EntryAction::List => {
                let entries = store.list_entries().await;
                if entries.is_empty() {
                    println!("No entries found.");
                } else {
                    let rows: Vec<EntryRow> = entries.into_iter().map(Into::into).collect();
                    println!("{}", Table::new(rows));
                }
            }
            EntryAction::Get { id } => {
                let entry = store.get_entry(&id).await?;
                let rows = vec![EntryRow::from(entry)];
                println!("{}", Table::new(rows));
            }
            EntryAction::CreateBasic {
                name,
                username,
                password,
                group_ids,
            } => {
                let created = store
                    .create_basic_entry(name, username, password, group_ids)
                    .await?;
                println!(
                    "Created basic auth entry: {} ({})",
                    created.meta.name, created.meta.id
                );
            }
            EntryAction::CreateToken { name, group_ids } => {
                let (created, token) = store.create_token_entry(name, group_ids).await?;
                println!(
                    "Created token auth entry: {} ({})",
                    created.meta.name, created.meta.id
                );
                println!("Token (save this, it won't be shown again): {token}");
            }
            EntryAction::Delete { id } => {
                store.delete_entry(&id).await?;
                println!("Deleted entry: {id}");
            }
            EntryAction::Update {
                id,
                name,
                username,
                password,
                group_ids,
            } => {
                let updated = store
                    .update_entry(&id, name, username, password, group_ids)
                    .await?;
                println!("Updated entry: {} ({})", updated.meta.name, updated.meta.id);
            }
        },
        Commands::Group { action } => match action {
            GroupAction::List => {
                let groups = store.list_groups().await;
                if groups.is_empty() {
                    println!("No groups found.");
                } else {
                    let rows: Vec<GroupRow> = groups.into_iter().map(Into::into).collect();
                    println!("{}", Table::new(rows));
                }
            }
            GroupAction::Get { id } => {
                let group = store.get_group(&id).await?;
                let rows = vec![GroupRow::from(group)];
                println!("{}", Table::new(rows));
            }
            GroupAction::Create { name, entry_ids } => {
                let group = Group::new(name);
                let created = store.create_group(group, entry_ids).await?;
                println!("Created group: {} ({})", created.name, created.id);
            }
            GroupAction::Update {
                id,
                name,
                entry_ids,
            } => {
                let updated = store.update_group(&id, name, entry_ids).await?;
                println!("Updated group: {} ({})", updated.name, updated.id);
            }
            GroupAction::Delete { id } => {
                store.delete_group(&id).await?;
                println!("Deleted group: {id}");
            }
        },
        Commands::Migrate { .. } => unreachable!("handled above"),
    }

    Ok(())
}
