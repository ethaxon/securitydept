use inquire::{Confirm, Password, PasswordDisplayMode, Text, validator::Validation};

use crate::error::{CliError, CliResult};

pub fn required_text(message: &str) -> CliResult<String> {
    Text::new(message)
        .with_validator(|value: &str| {
            if value.trim().is_empty() {
                Ok(Validation::Invalid("A value is required".into()))
            } else {
                Ok(Validation::Valid)
            }
        })
        .prompt()
        .map_err(interactive_error)
}

pub fn optional_text(message: &str) -> CliResult<Option<String>> {
    Text::new(message)
        .prompt()
        .map_err(interactive_error)
        .map(|value| (!value.trim().is_empty()).then_some(value))
}

pub fn comma_separated_values(message: &str) -> CliResult<Vec<String>> {
    Text::new(message)
        .prompt()
        .map_err(interactive_error)
        .map(|value| {
            value
                .split(',')
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
                .collect()
        })
}

pub fn password(message: &str) -> CliResult<String> {
    Password::new(message)
        .with_display_mode(PasswordDisplayMode::Masked)
        .with_custom_confirmation_message("Confirm password")
        .with_custom_confirmation_error_message("Passwords do not match")
        .with_validator(|value: &str| {
            if value.is_empty() {
                Ok(Validation::Invalid("Password must not be empty".into()))
            } else {
                Ok(Validation::Valid)
            }
        })
        .prompt()
        .map_err(interactive_error)
}

pub fn confirm(message: &str) -> CliResult<bool> {
    Confirm::new(message)
        .with_default(false)
        .prompt()
        .map_err(interactive_error)
}

fn interactive_error(error: inquire::InquireError) -> CliError {
    CliError::Interactive {
        message: error.to_string(),
    }
}
