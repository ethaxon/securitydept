use clap::{Parser, Subcommand};
use snafu::{ResultExt, Whatever};
use tabled::{Table, Tabled};
use tracing_subscriber::EnvFilter;

use securitydept_core::auth;
use securitydept_core::config::AppConfig;
use securitydept_core::models::{AuthEntry, AuthEntryKind, Group};
use securitydept_core::store::Store;

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
            id: e.id,
            name: e.name,
            kind: match e.kind {
                AuthEntryKind::Basic => "basic".to_string(),
                AuthEntryKind::Token => "token".to_string(),
            },
            username: e.username.unwrap_or_default(),
            group_ids: e.group_ids.join(", "),
            created_at: e.created_at.format("%Y-%m-%d %H:%M").to_string(),
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
async fn main() -> Result<(), Whatever> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("warn".parse().unwrap()))
        .init();

    let cli = Cli::parse();
    let config = AppConfig::load(&cli.config).whatever_context("Failed to load config")?;
    let store = Store::load(&config.data.path)
        .await
        .whatever_context("Failed to load data store")?;

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
                let entry = store
                    .get_entry(&id)
                    .await
                    .whatever_context("Failed to get entry")?;
                let rows = vec![EntryRow::from(entry)];
                println!("{}", Table::new(rows));
            }
            EntryAction::CreateBasic {
                name,
                username,
                password,
                group_ids,
            } => {
                let password_hash =
                    auth::hash_password(&password).whatever_context("Failed to hash password")?;
                let entry = AuthEntry::new_basic(name, username, password_hash, group_ids);
                let created = store
                    .create_entry(entry)
                    .await
                    .whatever_context("Failed to create entry")?;
                println!(
                    "Created basic auth entry: {} ({})",
                    created.name, created.id
                );
            }
            EntryAction::CreateToken { name, group_ids } => {
                let (token, token_hash) =
                    auth::generate_token().whatever_context("Failed to generate token")?;
                let entry = AuthEntry::new_token(name, token_hash, group_ids);
                let created = store
                    .create_entry(entry)
                    .await
                    .whatever_context("Failed to create entry")?;
                println!(
                    "Created token auth entry: {} ({})",
                    created.name, created.id
                );
                println!("Token (save this, it won't be shown again): {token}");
            }
            EntryAction::Delete { id } => {
                store
                    .delete_entry(&id)
                    .await
                    .whatever_context("Failed to delete entry")?;
                println!("Deleted entry: {id}");
            }
            EntryAction::Update {
                id,
                name,
                username,
                password,
                group_ids,
            } => {
                let password_hash = match password {
                    Some(pw) => Some(auth::hash_password(&pw).whatever_context("Failed to hash password")?),
                    None => None,
                };
                let updated = store
                    .update_entry(&id, name, username, password_hash, group_ids)
                    .await
                    .whatever_context("Failed to update entry")?;
                println!("Updated entry: {} ({})", updated.name, updated.id);
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
                let group = store
                    .get_group(&id)
                    .await
                    .whatever_context("Failed to get group")?;
                let rows = vec![GroupRow::from(group)];
                println!("{}", Table::new(rows));
            }
            GroupAction::Create { name, entry_ids } => {
                let group = Group::new(name);
                let created = store
                    .create_group(group, entry_ids)
                    .await
                    .whatever_context("Failed to create group")?;
                println!("Created group: {} ({})", created.name, created.id);
            }
            GroupAction::Update {
                id,
                name,
                entry_ids,
            } => {
                let updated = store
                    .update_group(&id, name, entry_ids)
                    .await
                    .whatever_context("Failed to update group")?;
                println!("Updated group: {} ({})", updated.name, updated.id);
            }
            GroupAction::Delete { id } => {
                store
                    .delete_group(&id)
                    .await
                    .whatever_context("Failed to delete group")?;
                println!("Deleted group: {id}");
            }
        },
    }

    Ok(())
}
