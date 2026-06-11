use url::{Url, form_urlencoded};

pub const SECURITYDEPT_COMPAT_FRAGMENT_VERSION: &str = "v1";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompatFragment {
    pub payload: String,
}

pub fn append_or_replace_compat_fragment(url: &mut Url, payload: &str) {
    let mut blocks = split_fragment_blocks(url.fragment().unwrap_or(""));
    if blocks
        .last()
        .is_some_and(|block| is_compat_fragment_block(block))
    {
        blocks.pop();
    }
    blocks.push(build_compat_fragment_block(payload));
    url.set_fragment(Some(&blocks.join("#")));
}

pub fn parse_compat_fragment(input: &str) -> Option<CompatFragment> {
    let fragment = Url::parse(input)
        .ok()
        .and_then(|url| url.fragment().map(ToOwned::to_owned))
        .unwrap_or_else(|| input.trim_start_matches('#').to_owned());
    let block = fragment.rsplit('#').next()?;
    if !is_compat_fragment_block(block) {
        return None;
    }

    let mut payload = form_urlencoded::Serializer::new(String::new());
    for (key, value) in form_urlencoded::parse(block.as_bytes()) {
        match key.as_ref() {
            "securitydept" => {}
            _ => {
                payload.append_pair(key.as_ref(), value.as_ref());
            }
        }
    }

    Some(CompatFragment {
        payload: payload.finish(),
    })
}

pub fn remove_compat_fragment(url: &mut Url) -> Option<CompatFragment> {
    let mut blocks = split_fragment_blocks(url.fragment()?);
    let parsed = blocks
        .last()
        .and_then(|block| parse_compat_fragment(block))?;
    blocks.pop();
    if blocks.is_empty() {
        url.set_fragment(None);
    } else {
        url.set_fragment(Some(&blocks.join("#")));
    }
    Some(parsed)
}

pub fn is_compat_fragment_block(block: &str) -> bool {
    form_urlencoded::parse(block.trim_start_matches('#').as_bytes())
        .any(|(key, value)| key == "securitydept" && value == SECURITYDEPT_COMPAT_FRAGMENT_VERSION)
}

fn split_fragment_blocks(fragment: &str) -> Vec<String> {
    let fragment = fragment.trim_start_matches('#');
    if fragment.is_empty() {
        Vec::new()
    } else {
        fragment.split('#').map(ToOwned::to_owned).collect()
    }
}

fn build_compat_fragment_block(payload: &str) -> String {
    let mut block = form_urlencoded::Serializer::new(String::new());
    block.append_pair("securitydept", SECURITYDEPT_COMPAT_FRAGMENT_VERSION);
    for (key, value) in form_urlencoded::parse(payload.trim_start_matches('#').as_bytes()) {
        if key != "securitydept" {
            block.append_pair(key.as_ref(), value.as_ref());
        }
    }
    block.finish()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn append_or_replace_compat_fragment_preserves_existing_hash_route() {
        let mut url = Url::parse("https://app.example.com/#/orders").expect("url should parse");

        append_or_replace_compat_fragment(&mut url, "access_token=at&id_token=idt");

        assert_eq!(
            url.as_str(),
            "https://app.example.com/#/orders#securitydept=v1&access_token=at&id_token=idt"
        );
    }

    #[test]
    fn append_or_replace_compat_fragment_replaces_existing_compat_block() {
        let mut url = Url::parse(
            "https://app.example.com/#/orders#securitydept=v1&kind=old&access_token=old",
        )
        .expect("url should parse");

        append_or_replace_compat_fragment(
            &mut url,
            "kind=token_set_backend_oidc_refresh&access_token=new",
        );

        assert_eq!(
            url.as_str(),
            "https://app.example.com/#/orders#securitydept=v1&kind=token_set_backend_oidc_refresh&access_token=new"
        );
    }

    #[test]
    fn parse_compat_fragment_reads_only_the_last_block() {
        let parsed = parse_compat_fragment(
            "https://app.example.com/#/orders#securitydept=v1&kind=token_set_backend_oidc_callback&access_token=at",
        )
        .expect("compat fragment should parse");

        assert_eq!(
            parsed.payload,
            "kind=token_set_backend_oidc_callback&access_token=at"
        );
    }

    #[test]
    fn parse_compat_fragment_ignores_non_compat_last_block() {
        assert_eq!(
            parse_compat_fragment("https://app.example.com/#/orders"),
            None
        );
    }

    #[test]
    fn remove_compat_fragment_preserves_user_hash() {
        let mut url = Url::parse(
            "https://app.example.com/#/orders#securitydept=v1&kind=token_set_backend_oidc_callback&access_token=at",
        )
        .expect("url should parse");

        let removed = remove_compat_fragment(&mut url).expect("fragment should be removed");

        assert_eq!(
            removed.payload,
            "kind=token_set_backend_oidc_callback&access_token=at"
        );
        assert_eq!(url.as_str(), "https://app.example.com/#/orders");
    }
}
