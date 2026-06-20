use clap::Subcommand;
use securitydept_core::creds_manage::{
    migrations::{Migrator, models::MigratorTrait},
    models::{AuthEntry, AuthEntryKind, Group},
    store::CredsManageStore,
};
use tabled::{Table, Tabled};

use crate::{
    config::CliConfig,
    error::{CliError, CliResult},
    prompt,
};

#[derive(Subcommand)]
pub enum CredsManageAction {
    /// Manage auth entries.
    Entry {
        #[command(subcommand)]
        action: EntryAction,
    },
    /// Manage groups.
    Group {
        #[command(subcommand)]
        action: GroupAction,
    },
    /// Manage data-file migrations.
    Migrate {
        #[command(subcommand)]
        action: MigrateAction,
    },
}

#[derive(Subcommand)]
pub enum EntryAction {
    /// List all auth entries.
    List,
    /// Get an auth entry by ID.
    Get {
        /// Prompt for the entry ID.
        #[arg(short, long)]
        interactive: bool,
        #[arg(
            long,
            required_unless_present = "interactive",
            conflicts_with = "interactive"
        )]
        id: Option<String>,
    },
    /// Create a basic auth entry in the managed data file.
    CreateBasic {
        /// Prompt for all required input, including a masked password
        /// confirmation.
        #[arg(short, long)]
        interactive: bool,
        #[arg(
            long,
            required_unless_present = "interactive",
            conflicts_with = "interactive"
        )]
        name: Option<String>,
        #[arg(
            long,
            required_unless_present = "interactive",
            conflicts_with = "interactive"
        )]
        username: Option<String>,
        #[arg(
            long,
            required_unless_present = "interactive",
            conflicts_with = "interactive"
        )]
        password: Option<String>,
        /// Comma-separated group IDs.
        #[arg(long, value_delimiter = ',', conflicts_with = "interactive")]
        group_ids: Vec<String>,
    },
    /// Create a token auth entry in the managed data file.
    CreateToken {
        /// Prompt for all required input.
        #[arg(short, long)]
        interactive: bool,
        #[arg(
            long,
            required_unless_present = "interactive",
            conflicts_with = "interactive"
        )]
        name: Option<String>,
        /// Comma-separated group IDs.
        #[arg(long, value_delimiter = ',', conflicts_with = "interactive")]
        group_ids: Vec<String>,
    },
    /// Delete an auth entry.
    Delete {
        /// Prompt for the entry ID and require confirmation.
        #[arg(short, long)]
        interactive: bool,
        #[arg(
            long,
            required_unless_present = "interactive",
            conflicts_with = "interactive"
        )]
        id: Option<String>,
    },
    /// Update an auth entry.
    Update {
        /// Prompt for the entry ID and fields to update.
        #[arg(short, long)]
        interactive: bool,
        #[arg(
            long,
            required_unless_present = "interactive",
            conflicts_with = "interactive"
        )]
        id: Option<String>,
        #[arg(long, conflicts_with = "interactive")]
        name: Option<String>,
        #[arg(long, conflicts_with = "interactive")]
        username: Option<String>,
        #[arg(long, conflicts_with = "interactive")]
        password: Option<String>,
        /// Comma-separated group IDs.
        #[arg(long, value_delimiter = ',', conflicts_with = "interactive")]
        group_ids: Option<Vec<String>>,
    },
}

#[derive(Subcommand)]
pub enum GroupAction {
    /// List all groups.
    List,
    /// Get a group by ID.
    Get {
        /// Prompt for the group ID.
        #[arg(short, long)]
        interactive: bool,
        #[arg(
            long,
            required_unless_present = "interactive",
            conflicts_with = "interactive"
        )]
        id: Option<String>,
    },
    /// Create a new group.
    Create {
        /// Prompt for all required input.
        #[arg(short, long)]
        interactive: bool,
        #[arg(
            long,
            required_unless_present = "interactive",
            conflicts_with = "interactive"
        )]
        name: Option<String>,
        /// Comma-separated auth entry IDs to bind with this group.
        #[arg(long, value_delimiter = ',', conflicts_with = "interactive")]
        entry_ids: Option<Vec<String>>,
    },
    /// Update a group.
    Update {
        /// Prompt for all required input.
        #[arg(short, long)]
        interactive: bool,
        #[arg(
            long,
            required_unless_present = "interactive",
            conflicts_with = "interactive"
        )]
        id: Option<String>,
        #[arg(
            long,
            required_unless_present = "interactive",
            conflicts_with = "interactive"
        )]
        name: Option<String>,
        /// Comma-separated auth entry IDs to bind with this group.
        #[arg(long, value_delimiter = ',', conflicts_with = "interactive")]
        entry_ids: Option<Vec<String>>,
    },
    /// Delete a group.
    Delete {
        /// Prompt for the group ID and require confirmation.
        #[arg(short, long)]
        interactive: bool,
        #[arg(
            long,
            required_unless_present = "interactive",
            conflicts_with = "interactive"
        )]
        id: Option<String>,
    },
}

#[derive(Subcommand)]
pub enum MigrateAction {
    /// Apply forward migrations.
    Up {
        /// Optional number of migration steps to apply.
        #[arg(long)]
        steps: Option<u32>,
    },
}

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
    fn from(entry: AuthEntry) -> Self {
        Self {
            id: entry.meta.id,
            name: entry.meta.name,
            kind: match entry.kind {
                AuthEntryKind::Basic => "basic".to_string(),
                AuthEntryKind::Token => "token".to_string(),
            },
            username: entry.username.unwrap_or_default(),
            group_ids: entry.meta.group_ids.join(", "),
            created_at: entry.meta.created_at.format("%Y-%m-%d %H:%M").to_string(),
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
    fn from(group: Group) -> Self {
        Self {
            id: group.id,
            name: group.name,
        }
    }
}

pub async fn execute(config: &CliConfig, action: CredsManageAction) -> CliResult<()> {
    let migrator = Migrator::default();
    migrator.try_auto_migrate(&config.creds_manage)?;

    if let CredsManageAction::Migrate { action } = &action {
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
    match action {
        CredsManageAction::Entry { action } => execute_entry_action(&store, action).await,
        CredsManageAction::Group { action } => execute_group_action(&store, action).await,
        CredsManageAction::Migrate { .. } => unreachable!("migrations return above"),
    }
}

async fn execute_entry_action(store: &CredsManageStore, action: EntryAction) -> CliResult<()> {
    match action {
        EntryAction::List => {
            let entries = store.list_entries().await;
            if entries.is_empty() {
                println!("No entries found.");
            } else {
                let rows: Vec<EntryRow> = entries.into_iter().map(Into::into).collect();
                println!("{}", Table::new(rows));
            }
        }
        EntryAction::Get { interactive, id } => {
            let id = input_or_prompt(interactive, id, "Entry ID")?;
            let entry = store.get_entry(&id).await?;
            println!("{}", Table::new(vec![EntryRow::from(entry)]));
        }
        EntryAction::CreateBasic {
            interactive,
            name,
            username,
            password,
            group_ids,
        } => {
            let (name, username, password, group_ids) = if interactive {
                (
                    prompt::required_text("Entry name")?,
                    prompt::required_text("Basic Auth username")?,
                    prompt::password("Basic Auth password")?,
                    prompt::comma_separated_values("Group IDs (comma-separated, optional)")?,
                )
            } else {
                (
                    required_argument(name, "--name")?,
                    required_argument(username, "--username")?,
                    required_argument(password, "--password")?,
                    group_ids,
                )
            };
            let created = store
                .create_basic_entry(name, username, password, group_ids)
                .await?;
            println!(
                "Created basic auth entry: {} ({})",
                created.meta.name, created.meta.id
            );
        }
        EntryAction::CreateToken {
            interactive,
            name,
            group_ids,
        } => {
            let (name, group_ids) = if interactive {
                (
                    prompt::required_text("Entry name")?,
                    prompt::comma_separated_values("Group IDs (comma-separated, optional)")?,
                )
            } else {
                (required_argument(name, "--name")?, group_ids)
            };
            let (created, token) = store.create_token_entry(name, group_ids).await?;
            println!(
                "Created token auth entry: {} ({})",
                created.meta.name, created.meta.id
            );
            println!("Token (save this, it won't be shown again): {token}");
        }
        EntryAction::Delete { interactive, id } => {
            let id = input_or_prompt(interactive, id, "Entry ID")?;
            if interactive && !prompt::confirm(&format!("Delete entry `{id}`?"))? {
                println!("Cancelled.");
                return Ok(());
            }
            store.delete_entry(&id).await?;
            println!("Deleted entry: {id}");
        }
        EntryAction::Update {
            interactive,
            id,
            name,
            username,
            password,
            group_ids,
        } => {
            let (id, name, username, password, group_ids) = if interactive {
                let id = prompt::required_text("Entry ID")?;
                let entry = store.get_entry(&id).await?;
                let name = prompt::optional_text("New entry name (leave blank to keep)")?;
                let (username, password) = if entry.kind == AuthEntryKind::Basic {
                    let username =
                        prompt::optional_text("New Basic Auth username (leave blank to keep)")?;
                    let password = if prompt::confirm("Change Basic Auth password?")? {
                        Some(prompt::password("New Basic Auth password")?)
                    } else {
                        None
                    };
                    (username, password)
                } else {
                    (None, None)
                };
                let group_ids = if prompt::confirm("Replace group memberships?")? {
                    Some(prompt::comma_separated_values(
                        "Group IDs (comma-separated; leave blank for none)",
                    )?)
                } else {
                    None
                };
                (id, name, username, password, group_ids)
            } else {
                (
                    required_argument(id, "--id")?,
                    name,
                    username,
                    password,
                    group_ids,
                )
            };
            let updated = store
                .update_entry(&id, name, username, password, group_ids)
                .await?;
            println!("Updated entry: {} ({})", updated.meta.name, updated.meta.id);
        }
    }
    Ok(())
}

async fn execute_group_action(store: &CredsManageStore, action: GroupAction) -> CliResult<()> {
    match action {
        GroupAction::List => {
            let groups = store.list_groups().await;
            if groups.is_empty() {
                println!("No groups found.");
            } else {
                let rows: Vec<GroupRow> = groups.into_iter().map(Into::into).collect();
                println!("{}", Table::new(rows));
            }
        }
        GroupAction::Get { interactive, id } => {
            let id = input_or_prompt(interactive, id, "Group ID")?;
            let group = store.get_group(&id).await?;
            println!("{}", Table::new(vec![GroupRow::from(group)]));
        }
        GroupAction::Create {
            interactive,
            name,
            entry_ids,
        } => {
            let (name, entry_ids) = if interactive {
                let entry_ids =
                    prompt::comma_separated_values("Entry IDs (comma-separated, optional)")?;
                (
                    prompt::required_text("Group name")?,
                    (!entry_ids.is_empty()).then_some(entry_ids),
                )
            } else {
                (required_argument(name, "--name")?, entry_ids)
            };
            let created = store.create_group(Group::new(name), entry_ids).await?;
            println!("Created group: {} ({})", created.name, created.id);
        }
        GroupAction::Update {
            interactive,
            id,
            name,
            entry_ids,
        } => {
            let (id, name, entry_ids) = if interactive {
                let id = prompt::required_text("Group ID")?;
                let name = prompt::required_text("New group name")?;
                let entry_ids = if prompt::confirm("Replace group memberships?")? {
                    Some(prompt::comma_separated_values(
                        "Entry IDs (comma-separated; leave blank for none)",
                    )?)
                } else {
                    None
                };
                (id, name, entry_ids)
            } else {
                (
                    required_argument(id, "--id")?,
                    required_argument(name, "--name")?,
                    entry_ids,
                )
            };
            let updated = store.update_group(&id, name, entry_ids).await?;
            println!("Updated group: {} ({})", updated.name, updated.id);
        }
        GroupAction::Delete { interactive, id } => {
            let id = input_or_prompt(interactive, id, "Group ID")?;
            if interactive && !prompt::confirm(&format!("Delete group `{id}`?"))? {
                println!("Cancelled.");
                return Ok(());
            }
            store.delete_group(&id).await?;
            println!("Deleted group: {id}");
        }
    }
    Ok(())
}

fn input_or_prompt(interactive: bool, value: Option<String>, message: &str) -> CliResult<String> {
    if interactive {
        prompt::required_text(message)
    } else {
        required_argument(value, message)
    }
}

fn required_argument(value: Option<String>, argument: &str) -> CliResult<String> {
    value.ok_or_else(|| CliError::InvalidInput {
        message: format!("{argument} is required unless --interactive is used"),
    })
}
