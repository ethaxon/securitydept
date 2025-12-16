use std::sync::OnceLock;

use rfc7239::parse as parse_forwarded;

use crate::config::ExternalBaseUrl;

/// HTTP/2 `:authority` pseudo-header name. Only present when the `http` crate accepts it.
static AUTHORITY_HEADER_NAME: OnceLock<Option<http::HeaderName>> = OnceLock::new();

fn authority_header_name() -> Option<&'static http::HeaderName> {
    AUTHORITY_HEADER_NAME
        .get_or_init(|| http::HeaderName::from_bytes(b":authority").ok())
        .as_ref()
}

/// Resolve the external base URL from config + HTTP request headers.
///
/// When config is `Auto`, the priority is:
///   1. `Forwarded` header (RFC 7239) — extract `host` and `proto`
///   2. `X-Forwarded-Host` / `X-Forwarded-Proto` (common non-standard)
///   3. `Host` / `:authority` (standard HTTP header)
///   4. Fallback to `http://{bind_host}:{bind_port}`
///
/// When config is `Fixed(url)`, just return that URL.
pub fn resolve_base_url(
    config: &ExternalBaseUrl,
    headers: &http::HeaderMap,
    fallback_host: &str,
    fallback_port: u16,
) -> String {
    match config {
        ExternalBaseUrl::Fixed(url) => url.clone(),
        ExternalBaseUrl::Auto => infer_from_headers(headers, fallback_host, fallback_port),
    }
}

/// Infer external base URL from request headers.
///
/// Each source yields (host, protocol) independently; we take the first non-None
/// host and first non-None protocol by priority, then infer protocol from host if
/// still missing, then fallback to bind address.
fn infer_from_headers(
    headers: &http::HeaderMap,
    fallback_host: &str,
    fallback_port: u16,
) -> String {
    let sources: [(Option<String>, Option<String>); 3] = [
        try_forwarded(headers),
        try_x_forwarded(headers),
        try_host_header(headers),
    ];

    let host_from_headers = sources.iter().find_map(|(h, _)| h.clone());
    let host = host_from_headers
        .clone()
        .unwrap_or_else(|| format_fallback_host(fallback_host, fallback_port));

    let protocol = sources
        .iter()
        .find_map(|(_, p)| p.clone())
        .or_else(|| {
            host_from_headers
                .as_ref()
                .map(|h| infer_protocol_from_host(h).to_string())
        })
        .unwrap_or_else(|| "http".to_string());

    format!("{}://{}", protocol, host)
}

/// Forwarded (RFC 7239): (host, protocol). Uses first node; strips quotes per §4.
fn try_forwarded(headers: &http::HeaderMap) -> (Option<String>, Option<String>) {
    let value = match headers
        .get(http::header::FORWARDED)
        .and_then(|v| v.to_str().ok())
    {
        Some(v) => v,
        None => return (None, None),
    };
    let mut nodes = parse_forwarded(value);
    let node = match nodes.next().and_then(|r| r.ok()) {
        Some(n) => n,
        None => return (None, None),
    };
    let host = node.host.map(|s| s.trim_matches('"').to_string());
    let protocol = node.protocol.map(|s| s.trim_matches('"').to_string());
    (host, protocol)
}

/// X-Forwarded-Host / X-Forwarded-Proto: (host, protocol). Proto is None if header missing.
fn try_x_forwarded(headers: &http::HeaderMap) -> (Option<String>, Option<String>) {
    let host = headers
        .get("x-forwarded-host")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let protocol = headers
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    (host, protocol)
}

/// Host / :authority: (host, None). Host is HTTP/1.1; :authority is the HTTP/2 pseudo-header.
/// Protocol cannot be inferred from these alone.
fn try_host_header(headers: &http::HeaderMap) -> (Option<String>, Option<String>) {
    let host = headers
        .get(http::header::HOST)
        .or_else(|| authority_header_name().and_then(|name| headers.get(name)))
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    (host, None)
}

/// When protocol is missing (e.g. only Host header), infer from host: loopback → http, else https.
fn infer_protocol_from_host(host: &str) -> &'static str {
    if is_loopback_host(host) {
        "http"
    } else {
        "https"
    }
}

fn format_fallback_host(host: &str, port: u16) -> String {
    if is_default_port("http", port) {
        host.to_string()
    } else {
        format!("{}:{}", host, port)
    }
}

fn is_default_port(proto: &str, port: u16) -> bool {
    matches!((proto, port), ("http", 80) | ("https", 443))
}

fn is_loopback_host(host: &str) -> bool {
    // Strip port if present
    let hostname = host.split(':').next().unwrap_or(host);
    matches!(hostname, "localhost" | "127.0.0.1" | "::1" | "[::1]")
}

#[cfg(test)]
mod tests {
    use super::*;
    use http::HeaderMap;

    fn make_fallback() -> (&'static str, u16) {
        ("0.0.0.0", 8080)
    }

    #[test]
    fn fixed_config_ignores_headers() {
        let config = ExternalBaseUrl::Fixed("https://fixed.example.com".to_string());
        let headers = HeaderMap::new();
        let (host, port) = make_fallback();
        assert_eq!(
            resolve_base_url(&config, &headers, host, port),
            "https://fixed.example.com"
        );
    }

    #[test]
    fn auto_with_forwarded_header() {
        let config = ExternalBaseUrl::Auto;
        let mut headers = HeaderMap::new();
        headers.insert(
            "forwarded",
            "for=192.0.2.60;proto=https;host=example.com"
                .parse()
                .unwrap(),
        );
        let (host, port) = make_fallback();
        assert_eq!(
            resolve_base_url(&config, &headers, host, port),
            "https://example.com"
        );
    }

    #[test]
    fn auto_with_forwarded_header_custom_port() {
        let config = ExternalBaseUrl::Auto;
        let mut headers = HeaderMap::new();
        headers.insert(
            "forwarded",
            "proto=https;host=example.com:8443".parse().unwrap(),
        );
        let (host, port) = make_fallback();
        assert_eq!(
            resolve_base_url(&config, &headers, host, port),
            "https://example.com:8443"
        );
    }

    #[test]
    fn auto_with_forwarded_header_no_proto() {
        let config = ExternalBaseUrl::Auto;
        let mut headers = HeaderMap::new();
        headers.insert("forwarded", "host=example.com".parse().unwrap());
        let (host, port) = make_fallback();
        // Default to https when proto is missing
        assert_eq!(
            resolve_base_url(&config, &headers, host, port),
            "https://example.com"
        );
    }

    #[test]
    fn auto_with_x_forwarded_headers() {
        let config = ExternalBaseUrl::Auto;
        let mut headers = HeaderMap::new();
        headers.insert("x-forwarded-host", "proxy.example.com".parse().unwrap());
        headers.insert("x-forwarded-proto", "https".parse().unwrap());
        let (host, port) = make_fallback();
        assert_eq!(
            resolve_base_url(&config, &headers, host, port),
            "https://proxy.example.com"
        );
    }

    #[test]
    fn auto_with_x_forwarded_host_only() {
        let config = ExternalBaseUrl::Auto;
        let mut headers = HeaderMap::new();
        headers.insert("x-forwarded-host", "proxy.example.com".parse().unwrap());
        let (host, port) = make_fallback();
        assert_eq!(
            resolve_base_url(&config, &headers, host, port),
            "https://proxy.example.com"
        );
    }

    #[test]
    fn auto_with_host_header() {
        let config = ExternalBaseUrl::Auto;
        let mut headers = HeaderMap::new();
        headers.insert(http::header::HOST, "myhost.example.com".parse().unwrap());
        let (host, port) = make_fallback();
        assert_eq!(
            resolve_base_url(&config, &headers, host, port),
            "https://myhost.example.com"
        );
    }

    #[test]
    fn auto_with_localhost_host_header() {
        let config = ExternalBaseUrl::Auto;
        let mut headers = HeaderMap::new();
        headers.insert(http::header::HOST, "localhost:3000".parse().unwrap());
        let (host, port) = make_fallback();
        assert_eq!(
            resolve_base_url(&config, &headers, host, port),
            "http://localhost:3000"
        );
    }

    #[test]
    fn auto_fallback_to_bind_address() {
        let config = ExternalBaseUrl::Auto;
        let headers = HeaderMap::new();
        assert_eq!(
            resolve_base_url(&config, &headers, "0.0.0.0", 8080),
            "http://0.0.0.0:8080"
        );
    }

    #[test]
    fn auto_fallback_default_port() {
        let config = ExternalBaseUrl::Auto;
        let headers = HeaderMap::new();
        assert_eq!(
            resolve_base_url(&config, &headers, "0.0.0.0", 80),
            "http://0.0.0.0"
        );
    }

    #[test]
    fn forwarded_takes_priority_over_x_forwarded() {
        let config = ExternalBaseUrl::Auto;
        let mut headers = HeaderMap::new();
        headers.insert(
            "forwarded",
            "proto=https;host=rfc.example.com".parse().unwrap(),
        );
        headers.insert(
            "x-forwarded-host",
            "nonstandard.example.com".parse().unwrap(),
        );
        let (host, port) = make_fallback();
        assert_eq!(
            resolve_base_url(&config, &headers, host, port),
            "https://rfc.example.com"
        );
    }

    #[test]
    fn x_forwarded_takes_priority_over_host() {
        let config = ExternalBaseUrl::Auto;
        let mut headers = HeaderMap::new();
        headers.insert("x-forwarded-host", "proxy.example.com".parse().unwrap());
        headers.insert("x-forwarded-proto", "https".parse().unwrap());
        headers.insert(http::header::HOST, "internal.example.com".parse().unwrap());
        let (host, port) = make_fallback();
        assert_eq!(
            resolve_base_url(&config, &headers, host, port),
            "https://proxy.example.com"
        );
    }

    #[test]
    fn forwarded_with_quoted_values() {
        let config = ExternalBaseUrl::Auto;
        let mut headers = HeaderMap::new();
        headers.insert(
            "forwarded",
            "for=\"192.0.2.60\";proto=https;host=\"quoted.example.com\""
                .parse()
                .unwrap(),
        );
        let (host, port) = make_fallback();
        assert_eq!(
            resolve_base_url(&config, &headers, host, port),
            "https://quoted.example.com"
        );
    }

    #[test]
    fn forwarded_chain_uses_first_entry() {
        let config = ExternalBaseUrl::Auto;
        let mut headers = HeaderMap::new();
        headers.insert(
            "forwarded",
            "proto=https;host=first.example.com, proto=http;host=second.example.com"
                .parse()
                .unwrap(),
        );
        let (host, port) = make_fallback();
        assert_eq!(
            resolve_base_url(&config, &headers, host, port),
            "https://first.example.com"
        );
    }

    #[test]
    fn authority_used_when_host_absent_if_supported() {
        let name = match authority_header_name() {
            Some(n) => n.clone(),
            None => return, // http crate does not accept :authority
        };
        let config = ExternalBaseUrl::Auto;
        let mut headers = HeaderMap::new();
        headers.insert(name, "h2.example.com".parse().unwrap());
        let (host, port) = make_fallback();
        assert_eq!(
            resolve_base_url(&config, &headers, host, port),
            "https://h2.example.com"
        );
    }

    #[test]
    fn host_takes_priority_over_authority() {
        let config = ExternalBaseUrl::Auto;
        let mut headers = HeaderMap::new();
        headers.insert(http::header::HOST, "host.example.com".parse().unwrap());
        if let Some(name) = authority_header_name() {
            headers.insert(name.clone(), "authority.example.com".parse().unwrap());
        }
        let (host, port) = make_fallback();
        assert_eq!(
            resolve_base_url(&config, &headers, host, port),
            "https://host.example.com"
        );
    }
}
