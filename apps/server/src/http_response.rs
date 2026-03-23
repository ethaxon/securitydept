use axum::{body::Body, response::Response};
use securitydept_core::utils::http::HttpResponse;

pub fn into_axum_response(value: HttpResponse) -> Response {
    let mut response = Response::new(Body::empty());
    *response.status_mut() = value.status;
    *response.headers_mut() = value.headers;
    response
}
