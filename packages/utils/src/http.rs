use http::StatusCode;

pub trait ToHttpStatus {
    fn to_http_status(&self) -> StatusCode;
}
