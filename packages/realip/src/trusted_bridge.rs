use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use rand::TryRng;

use crate::{RealIpError, RealIpResult};

/// Generate an opaque value that is safe to embed in a trusted bridge header
/// name.
pub fn generate_trusted_bridge_secret_bearer() -> RealIpResult<String> {
    let mut bytes = [0_u8; 32];
    rand::rng()
        .try_fill_bytes(&mut bytes)
        .map_err(|error| RealIpError::RandomBytes {
            message: error.to_string(),
        })?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

#[cfg(test)]
mod tests {
    use super::generate_trusted_bridge_secret_bearer;

    #[test]
    fn generated_secret_bearer_is_header_token_safe() {
        let value = generate_trusted_bridge_secret_bearer().expect("generate secret bearer");

        assert_eq!(value.len(), 43);
        assert!(
            value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        );
    }
}
