use serde::Serialize;
use serde_json::{Map, Value};

pub struct AuthFlowOperation;

impl AuthFlowOperation {
    pub const PROJECTION_CONFIG_FETCH: &'static str = "projection.config_fetch";
    pub const OIDC_AUTHORIZE: &'static str = "oidc.authorize";
    pub const OIDC_CALLBACK: &'static str = "oidc.callback";
    pub const OIDC_METADATA_REDEEM: &'static str = "oidc.metadata_redeem";
    pub const OIDC_TOKEN_REFRESH: &'static str = "oidc.token_refresh";
    pub const OIDC_USER_INFO: &'static str = "oidc.user_info";
    pub const FORWARD_AUTH_CHECK: &'static str = "forward_auth.check";
    pub const PROPAGATION_FORWARD: &'static str = "propagation.forward";
    pub const BASIC_AUTH_LOGIN: &'static str = "basic_auth.login";
    pub const BASIC_AUTH_LOGOUT: &'static str = "basic_auth.logout";
    pub const BASIC_AUTH_AUTHORIZE: &'static str = "basic_auth.authorize";
    pub const SESSION_LOGIN: &'static str = "session.login";
    pub const SESSION_LOGOUT: &'static str = "session.logout";
    pub const SESSION_USER_INFO: &'static str = "session.user_info";
    pub const DASHBOARD_AUTH_CHECK: &'static str = "dashboard_auth.check";
    pub const CREDS_MANAGE_GROUP_LIST: &'static str = "creds_manage.group.list";
    pub const CREDS_MANAGE_GROUP_GET: &'static str = "creds_manage.group.get";
    pub const CREDS_MANAGE_GROUP_CREATE: &'static str = "creds_manage.group.create";
    pub const CREDS_MANAGE_GROUP_UPDATE: &'static str = "creds_manage.group.update";
    pub const CREDS_MANAGE_GROUP_DELETE: &'static str = "creds_manage.group.delete";
    pub const CREDS_MANAGE_ENTRY_LIST: &'static str = "creds_manage.entry.list";
    pub const CREDS_MANAGE_ENTRY_GET: &'static str = "creds_manage.entry.get";
    pub const CREDS_MANAGE_ENTRY_CREATE_BASIC: &'static str = "creds_manage.entry.create_basic";
    pub const CREDS_MANAGE_ENTRY_CREATE_TOKEN: &'static str = "creds_manage.entry.create_token";
    pub const CREDS_MANAGE_ENTRY_UPDATE: &'static str = "creds_manage.entry.update";
    pub const CREDS_MANAGE_ENTRY_DELETE: &'static str = "creds_manage.entry.delete";
}

pub struct AuthFlowDiagnosisField;

impl AuthFlowDiagnosisField {
    pub const ADAPTER: &'static str = "adapter";
    pub const ACCESS_TOKEN_PRESENT: &'static str = "access_token_present";
    pub const AUTH_FAMILY: &'static str = "auth_family";
    pub const AUTH_SCHEME: &'static str = "auth_scheme";
    pub const CALLBACK_PATH: &'static str = "callback_path";
    pub const CREDENTIAL_SOURCE: &'static str = "credential_source";
    pub const DIRECTIVE_HEADER: &'static str = "directive_header";
    pub const ENTRY_IDS_COUNT: &'static str = "entry_ids_count";
    pub const ENTRY_NAME: &'static str = "entry_name";
    pub const ENTITY_KIND: &'static str = "entity_kind";
    pub const EXTERNAL_BASE_URL: &'static str = "external_base_url";
    pub const FAILURE_STAGE: &'static str = "failure_stage";
    pub const GROUP: &'static str = "group";
    pub const GROUP_ID: &'static str = "group_id";
    pub const GROUP_IDS_COUNT: &'static str = "group_ids_count";
    pub const HAS_AUTHORIZATION_HEADER: &'static str = "has_authorization_header";
    pub const HAS_CODE: &'static str = "has_code";
    pub const HAS_COOKIE_HEADER: &'static str = "has_cookie_header";
    pub const HAS_ID_TOKEN: &'static str = "has_id_token";
    pub const HAS_METADATA: &'static str = "has_metadata";
    pub const HAS_POST_AUTH_REDIRECT_URI: &'static str = "has_post_auth_redirect_uri";
    pub const HAS_PROPAGATION_DIRECTIVE: &'static str = "has_propagation_directive";
    pub const HAS_REQUESTED_POST_AUTH_REDIRECT_URI: &'static str =
        "has_requested_post_auth_redirect_uri";
    pub const HAS_STATE: &'static str = "has_state";
    pub const HAS_TARGET_ID: &'static str = "has_target_id";
    pub const HTTP_STATUS: &'static str = "http_status";
    pub const METADATA_ID_PRESENT: &'static str = "metadata_id_present";
    pub const METADATA_REDEEMED: &'static str = "metadata_redeemed";
    pub const METHOD: &'static str = "method";
    pub const MODE: &'static str = "mode";
    pub const OPERATION_KIND: &'static str = "operation_kind";
    pub const POST_AUTH_REDIRECT_PRESENT: &'static str = "post_auth_redirect_present";
    pub const PROPAGATION_ENABLED: &'static str = "propagation_enabled";
    pub const REASON: &'static str = "reason";
    pub const REQUEST_PATH: &'static str = "request_path";
    pub const RESPONSE_TRANSPORT: &'static str = "response_transport";
    pub const RESOLVED_CLIENT_IP_PRESENT: &'static str = "resolved_client_ip_present";
    pub const RESULT_COUNT: &'static str = "result_count";
    pub const ROUTE: &'static str = "route";
    pub const STATUS: &'static str = "status";
    pub const SUBJECT: &'static str = "subject";
    pub const TARGET_ID: &'static str = "target_id";
    pub const TARGET_PATH: &'static str = "target_path";
    pub const TOKEN_CREATED: &'static str = "token_created";
    pub const TRANSPORT: &'static str = "transport";
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthFlowDiagnosisOutcome {
    Started,
    Succeeded,
    Failed,
    Rejected,
}

impl AuthFlowDiagnosisOutcome {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Started => "started",
            Self::Succeeded => "succeeded",
            Self::Failed => "failed",
            Self::Rejected => "rejected",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct AuthFlowDiagnosis {
    pub operation: String,
    pub outcome: AuthFlowDiagnosisOutcome,
    #[serde(default, skip_serializing_if = "Map::is_empty")]
    pub fields: Map<String, Value>,
}

impl AuthFlowDiagnosis {
    pub fn new(operation: impl Into<String>, outcome: AuthFlowDiagnosisOutcome) -> Self {
        Self {
            operation: operation.into(),
            outcome,
            fields: Map::new(),
        }
    }

    pub fn started(operation: impl Into<String>) -> Self {
        Self::new(operation, AuthFlowDiagnosisOutcome::Started)
    }

    pub fn succeeded(operation: impl Into<String>) -> Self {
        Self::new(operation, AuthFlowDiagnosisOutcome::Succeeded)
    }

    pub fn failed(operation: impl Into<String>) -> Self {
        Self::new(operation, AuthFlowDiagnosisOutcome::Failed)
    }

    pub fn rejected(operation: impl Into<String>) -> Self {
        Self::new(operation, AuthFlowDiagnosisOutcome::Rejected)
    }

    pub fn with_outcome(mut self, outcome: AuthFlowDiagnosisOutcome) -> Self {
        self.outcome = outcome;
        self
    }

    pub fn field<V>(mut self, key: impl Into<String>, value: V) -> Self
    where
        V: Serialize,
    {
        if let Ok(value) = serde_json::to_value(value) {
            self.fields.insert(key.into(), value);
        }
        self
    }

    pub fn to_json_value(&self) -> Value {
        serde_json::to_value(self).unwrap_or_else(|_| Value::Null)
    }
}

#[derive(Debug)]
pub struct DiagnosedResult<T, E> {
    diagnosis: AuthFlowDiagnosis,
    result: Result<T, E>,
}

impl<T, E> DiagnosedResult<T, E> {
    pub fn success(diagnosis: AuthFlowDiagnosis, value: T) -> Self {
        Self {
            diagnosis,
            result: Ok(value),
        }
    }

    pub fn failure(diagnosis: AuthFlowDiagnosis, error: E) -> Self {
        Self {
            diagnosis,
            result: Err(error),
        }
    }

    pub fn diagnosis(&self) -> &AuthFlowDiagnosis {
        &self.diagnosis
    }

    pub fn result(&self) -> &Result<T, E> {
        &self.result
    }

    pub fn into_result(self) -> Result<T, E> {
        self.result
    }

    pub fn into_parts(self) -> (AuthFlowDiagnosis, Result<T, E>) {
        (self.diagnosis, self.result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_flow_operation_constants_remain_stable() {
        assert_eq!(
            AuthFlowOperation::PROJECTION_CONFIG_FETCH,
            "projection.config_fetch"
        );
        assert_eq!(AuthFlowOperation::OIDC_AUTHORIZE, "oidc.authorize");
        assert_eq!(AuthFlowOperation::OIDC_CALLBACK, "oidc.callback");
        assert_eq!(
            AuthFlowOperation::OIDC_METADATA_REDEEM,
            "oidc.metadata_redeem"
        );
        assert_eq!(AuthFlowOperation::OIDC_TOKEN_REFRESH, "oidc.token_refresh");
        assert_eq!(AuthFlowOperation::OIDC_USER_INFO, "oidc.user_info");
        assert_eq!(AuthFlowOperation::FORWARD_AUTH_CHECK, "forward_auth.check");
        assert_eq!(
            AuthFlowOperation::PROPAGATION_FORWARD,
            "propagation.forward"
        );
        assert_eq!(AuthFlowOperation::BASIC_AUTH_LOGIN, "basic_auth.login");
        assert_eq!(AuthFlowOperation::BASIC_AUTH_LOGOUT, "basic_auth.logout");
        assert_eq!(
            AuthFlowOperation::BASIC_AUTH_AUTHORIZE,
            "basic_auth.authorize"
        );
        assert_eq!(AuthFlowOperation::SESSION_LOGIN, "session.login");
        assert_eq!(AuthFlowOperation::SESSION_LOGOUT, "session.logout");
        assert_eq!(AuthFlowOperation::SESSION_USER_INFO, "session.user_info");
        assert_eq!(
            AuthFlowOperation::DASHBOARD_AUTH_CHECK,
            "dashboard_auth.check"
        );
        assert_eq!(
            AuthFlowOperation::CREDS_MANAGE_GROUP_LIST,
            "creds_manage.group.list"
        );
        assert_eq!(
            AuthFlowOperation::CREDS_MANAGE_GROUP_GET,
            "creds_manage.group.get"
        );
        assert_eq!(
            AuthFlowOperation::CREDS_MANAGE_GROUP_CREATE,
            "creds_manage.group.create"
        );
        assert_eq!(
            AuthFlowOperation::CREDS_MANAGE_GROUP_UPDATE,
            "creds_manage.group.update"
        );
        assert_eq!(
            AuthFlowOperation::CREDS_MANAGE_GROUP_DELETE,
            "creds_manage.group.delete"
        );
        assert_eq!(
            AuthFlowOperation::CREDS_MANAGE_ENTRY_LIST,
            "creds_manage.entry.list"
        );
        assert_eq!(
            AuthFlowOperation::CREDS_MANAGE_ENTRY_GET,
            "creds_manage.entry.get"
        );
        assert_eq!(
            AuthFlowOperation::CREDS_MANAGE_ENTRY_CREATE_BASIC,
            "creds_manage.entry.create_basic"
        );
        assert_eq!(
            AuthFlowOperation::CREDS_MANAGE_ENTRY_CREATE_TOKEN,
            "creds_manage.entry.create_token"
        );
        assert_eq!(
            AuthFlowOperation::CREDS_MANAGE_ENTRY_UPDATE,
            "creds_manage.entry.update"
        );
        assert_eq!(
            AuthFlowOperation::CREDS_MANAGE_ENTRY_DELETE,
            "creds_manage.entry.delete"
        );
    }

    #[test]
    fn auth_flow_diagnosis_field_constants_work_with_field_insertion() {
        let diagnosis = AuthFlowDiagnosis::started(AuthFlowOperation::DASHBOARD_AUTH_CHECK)
            .field(AuthFlowDiagnosisField::AUTH_FAMILY, "dashboard")
            .field(AuthFlowDiagnosisField::CREDENTIAL_SOURCE, "bearer")
            .field(AuthFlowDiagnosisField::HAS_COOKIE_HEADER, true)
            .field(AuthFlowDiagnosisField::PROPAGATION_ENABLED, false)
            .field(AuthFlowDiagnosisField::REASON, "propagation_disabled");

        let value = diagnosis.to_json_value();
        assert_eq!(
            value["fields"][AuthFlowDiagnosisField::AUTH_FAMILY],
            "dashboard"
        );
        assert_eq!(
            value["fields"][AuthFlowDiagnosisField::CREDENTIAL_SOURCE],
            "bearer"
        );
        assert_eq!(
            value["fields"][AuthFlowDiagnosisField::HAS_COOKIE_HEADER],
            true
        );
        assert_eq!(
            value["fields"][AuthFlowDiagnosisField::PROPAGATION_ENABLED],
            false
        );
        assert_eq!(
            value["fields"][AuthFlowDiagnosisField::REASON],
            "propagation_disabled"
        );
    }

    #[test]
    fn diagnosis_serializes_operation_outcome_and_fields() {
        let diagnosis = AuthFlowDiagnosis::started(AuthFlowOperation::PROJECTION_CONFIG_FETCH)
            .field(AuthFlowDiagnosisField::MODE, "frontend_oidc")
            .field("pkce_enabled", true);

        let value = diagnosis.to_json_value();
        assert_eq!(
            value["operation"],
            AuthFlowOperation::PROJECTION_CONFIG_FETCH
        );
        assert_eq!(value["outcome"], "started");
        assert_eq!(
            value["fields"][AuthFlowDiagnosisField::MODE],
            "frontend_oidc"
        );
        assert_eq!(value["fields"]["pkce_enabled"], true);
    }

    #[test]
    fn auth_flow_diagnosis_extended_field_constants_remain_stable() {
        assert_eq!(
            AuthFlowDiagnosisField::ACCESS_TOKEN_PRESENT,
            "access_token_present"
        );
        assert_eq!(AuthFlowDiagnosisField::AUTH_SCHEME, "auth_scheme");
        assert_eq!(AuthFlowDiagnosisField::CALLBACK_PATH, "callback_path");
        assert_eq!(AuthFlowDiagnosisField::ENTRY_IDS_COUNT, "entry_ids_count");
        assert_eq!(AuthFlowDiagnosisField::ENTRY_NAME, "entry_name");
        assert_eq!(
            AuthFlowDiagnosisField::EXTERNAL_BASE_URL,
            "external_base_url"
        );
        assert_eq!(AuthFlowDiagnosisField::HAS_CODE, "has_code");
        assert_eq!(AuthFlowDiagnosisField::HAS_ID_TOKEN, "has_id_token");
        assert_eq!(AuthFlowDiagnosisField::HAS_METADATA, "has_metadata");
        assert_eq!(
            AuthFlowDiagnosisField::HAS_POST_AUTH_REDIRECT_URI,
            "has_post_auth_redirect_uri"
        );
        assert_eq!(
            AuthFlowDiagnosisField::HAS_REQUESTED_POST_AUTH_REDIRECT_URI,
            "has_requested_post_auth_redirect_uri"
        );
        assert_eq!(AuthFlowDiagnosisField::HAS_STATE, "has_state");
        assert_eq!(
            AuthFlowDiagnosisField::METADATA_ID_PRESENT,
            "metadata_id_present"
        );
        assert_eq!(
            AuthFlowDiagnosisField::METADATA_REDEEMED,
            "metadata_redeemed"
        );
        assert_eq!(
            AuthFlowDiagnosisField::POST_AUTH_REDIRECT_PRESENT,
            "post_auth_redirect_present"
        );
        assert_eq!(
            AuthFlowDiagnosisField::RESPONSE_TRANSPORT,
            "response_transport"
        );
        assert_eq!(AuthFlowDiagnosisField::RESULT_COUNT, "result_count");
        assert_eq!(AuthFlowDiagnosisField::SUBJECT, "subject");
    }

    #[test]
    fn diagnosed_result_preserves_diagnosis_on_failure() {
        let diagnosed = DiagnosedResult::<(), &str>::failure(
            AuthFlowDiagnosis::failed(AuthFlowOperation::PROPAGATION_FORWARD)
                .field(AuthFlowDiagnosisField::REASON, "missing_header"),
            "boom",
        );

        assert!(diagnosed.result().is_err());
        assert_eq!(
            diagnosed.diagnosis().operation,
            AuthFlowOperation::PROPAGATION_FORWARD
        );
        assert_eq!(
            diagnosed.diagnosis().fields[AuthFlowDiagnosisField::REASON],
            "missing_header"
        );
    }
}
