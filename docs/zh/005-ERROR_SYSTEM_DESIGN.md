# 错误系统设计

SecurityDept 将内部诊断与公开错误展示分离。目标是在保留可运维日志的同时，避免向 browser 和 API consumer 泄露 provider、token、storage 或 configuration 细节。

## 当前模型

当前模型有三层彼此独立的语义：

- 内部错误枚举，通常由 `snafu` 实现。
- 通过 `ToHttpStatus` 或 route/service status helpers 映射 HTTP status。
- 通过 `ToErrorPresentation` 生成安全的 public presentation。

共享类型位于 `securitydept-utils`：

- `ErrorPresentation`
- `UserRecovery`
- `ServerErrorKind`
- `ServerErrorDescriptor`
- `ServerErrorEnvelope`
- `ToErrorPresentation`

通过 shared envelope 渲染的 server response 使用以下形状：

```json
{
  "success": false,
  "status": 401,
  "error": {
    "kind": "unauthenticated",
    "code": "backend_oidc_mode.bearer_token_required",
    "message": "A bearer access token is required for this endpoint.",
    "recovery": "reauthenticate",
    "presentation": {
      "code": "backend_oidc_mode.bearer_token_required",
      "message": "A bearer access token is required for this endpoint.",
      "recovery": "reauthenticate"
    }
  }
}
```

顶层 `code` / `message` / `recovery` 是稳定 consumer convenience fields。嵌套的 `presentation` 保留原始 presentation object，供已经消费它的客户端使用。

## Public Response 规则

- 不要从 `Display`、`source.to_string()`、provider response body、transport error 或任意 lower-layer text 派生 public message。
- 如果 lower-layer condition 对用户有意义，先提升成 typed variant 或 typed reason enum，再公开。
- 只有当 condition 安全且可行动时，public message 才能具体。
- 内部日志应包含完整 error chain；public response 只包含 sanitized code、message 与 recovery。

## Recovery Vocabulary

`UserRecovery` 是公开 action hint：

- `none`：不暗示用户恢复动作。
- `retry`：可以合理重试同一操作。
- `restart_flow`：重新开始当前 auth flow。
- `reauthenticate`：重新登录或重新获取凭证。
- `contact_support`：用户无法自行解决。

它优于 `retryable`、`reauth_required` 等多个布尔字段，因为枚举能避免含义模糊的组合。

## Disclosure Policy

| 分类 | Public message 风格 | 示例 |
| --- | --- | --- |
| Safe and specific | 解释可恢复问题 | invalid redirect URL、expired login request、duplicate callback state |
| Safe but generic | 保持上下文宽泛 | session expired、authentication required、access denied |
| Internal only | 永不公开 raw detail | metadata fetch errors、introspection transport failures、storage errors、crypto / sealing failures |

## Route Response Exceptions

大多数普通 server failures 使用 `ServerErrorEnvelope`，但部分 route families 有意不使用：

- Basic Auth challenge routes 必须保留 `WWW-Authenticate`。
- Basic Auth logout poison responses 必须保持 plain `401`，且不带新的 challenge。
- ForwardAuth challenge routes 必须保留 proxy protocol semantics。
- Backend-mode `metadata/redeem` not-found 是业务 `404`，不是 shared server failure envelope。
- Propagation forwarding 保留 underlying upstream status / presentation，而不是改写成 route-local generic error。
- Static web UI fallback errors 来自底层 static-file service。

`apps/server/src/routes/policy.rs` 中的 mounted-route policy table 记录这些边界，防止新 route 静默回退 response shape。

## Implementation Owners

- `packages/utils/src/error.rs`：shared presentation 与 envelope types。
- `packages/oidc-client/src/error.rs`：OIDC public presentation。
- `packages/oauth-resource-server/src/error.rs`：resource-server presentation。
- `packages/creds/src/error.rs`：credential verification presentation。
- `packages/creds-manage/src/error.rs`：credential-management presentation。
- `packages/session-context/src/lib.rs` 与 `packages/session-context/src/service.rs`：session presentation。
- `packages/basic-auth-context/src/service.rs`：Basic Auth context presentation。
- `packages/token-set-context/src/**/error.rs` 与 service modules：token-set、substrate、propagation、forwarder presentation。
- `apps/server/src/error.rs`：shared server envelope rendering。
- `apps/server/src/routes/policy.rs`：mounted-route response-shape policy。
- `apps/webui`：host-side presentation components 与 recovery links。

## 维护规则

- 新 public route 必须有明确 response-shape classification。
- 能到达 adopter-facing response 的新 error variant 必须实现 safe presentation。
- 如果会破坏 browser 或 proxy semantics，protocol-specific routes 不得被“统一”进 shared JSON envelope。
- Tests 应断言 `kind`、`code` 与 `recovery`；message text 可以验证，但不能成为唯一 machine contract。

---

[English](../en/005-ERROR_SYSTEM_DESIGN.md) | [中文](005-ERROR_SYSTEM_DESIGN.md)
