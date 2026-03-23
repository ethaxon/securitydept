use http::{
    HeaderMap, HeaderName, HeaderValue, StatusCode,
    header::{LOCATION, WWW_AUTHENTICATE},
};

pub trait ToHttpStatus {
    fn to_http_status(&self) -> StatusCode;
}

#[derive(Debug, Clone)]
pub struct HttpResponse {
    pub status: StatusCode,
    pub headers: HeaderMap,
}

impl HttpResponse {
    pub fn new(status: StatusCode) -> Self {
        Self {
            status,
            headers: HeaderMap::new(),
        }
    }

    pub fn with_header(mut self, name: HeaderName, value: &str) -> Self {
        if let Ok(value) = HeaderValue::from_str(value) {
            self.headers.insert(name, value);
        }

        self
    }

    pub fn temporary_redirect(location: &str) -> Self {
        Self::new(StatusCode::TEMPORARY_REDIRECT).with_header(LOCATION, location)
    }

    pub fn found(location: &str) -> Self {
        Self::new(StatusCode::FOUND).with_header(LOCATION, location)
    }

    pub fn unauthorized_with_basic_challenge(challenge: &str) -> Self {
        Self::new(StatusCode::UNAUTHORIZED).with_header(WWW_AUTHENTICATE, challenge)
    }
}
