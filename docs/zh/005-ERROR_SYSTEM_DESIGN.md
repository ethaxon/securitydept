# 错误系统设计

本文档描述了 SecurityDept 中当前错误处理的形态、该形态中的安全问题，以及推荐的未来方向。

主要设计目标很简单：

- 为日志和运营保留丰富的内部诊断信息
- 向终端用户返回安全但有用的消息
- 避免将所有内容压缩为模糊的 `Authentication failed`

## 当前状态

当前代码库已经具有两个有用的层次：

1. `snafu` 枚举建模特定领域的错误变体
2. `ToHttpStatus` 将这些变体映射到 HTTP 状态码

示例：

- `packages/oidc-client/src/error.rs`
- `packages/oauth-resource-server/src/error.rs`
- `packages/creds-manage/src/error.rs`
- `apps/server/src/error.rs`

当前参考服务器通过将错误转换为 JSON 来返回：

- `status` 来自 `ToHttpStatus`
- `error` 来自 `self.to_string()`

这很方便，但它耦合了两个不同的关注点：

- 内部诊断文本
- 面向用户的响应文本

对于认证流程来说，这通常是不安全的。原始错误字符串可能包含：

- 提供者端的故障详情
- 确切的配置错误
- 令牌或回调处理上下文
- 存储或密封故障详情

这些信息在日志中很有用，但它们不应自动发送到浏览器或 CLI 用户。

## 问题陈述

除了 `snafu` 和 `ToHttpStatus` 之外，项目还需要第三层：

- 面向用户的错误展示

这一层应该回答：

- 用户应该看到什么消息？
- 该消息应该多具体？
- 前端应该接收什么稳定的机器代码？

它不应将 `Display` 用作公共消息契约。

## 设计目标

- 为日志和调试保留完整的内部上下文
- 保持 HTTP 状态映射与展示分离
- 允许针对变体的安全消息用于认证流程
- 当某些上下文可以安全暴露时，允许每个实例的可选覆盖
- 为前端提供稳定的错误 `code`，而不是强制消息解析
- 使审计哪些变体披露特定的用户可见原因变得容易

## 推荐模型

保持当前的 `snafu` 枚举作为内部事实来源。

添加一个独立的展示 trait，例如：

```rust
use std::borrow::Cow;

pub struct ErrorPresentation {
    pub code: &'static str,
    pub message: Cow<'static, str>,
}

pub trait ToErrorPresentation {
    fn to_error_presentation(&self) -> ErrorPresentation;
}
```

然后每个面向公共的错误类型实现三个独立的关注点：

- `Display`：内部诊断文本
- `ToHttpStatus`：HTTP 语义
- `ToErrorPresentation`：安全的公共响应

这是核心变化。

## 为什么变体级别的公共消息很重要

像 `Authentication failed` 这样的通用消息对于真实的 UX 来说通常太弱了。

一些认证失败应该以具体但经过清理的方式披露：

- 无效的登录重定向 URL
- 授权码已过期
- 授权码已被使用
- 登录请求已过期
- CSRF 或状态验证失败

这些情况让用户可以通过重试或联系运营人员来恢复，并有明确的症状。

其他失败应该保持通用：

- 上游元数据获取失败
- HTTP 客户端传输错误
- 令牌密封故障
- 文件系统或数据库故障
- 意外的提供者响应体

这些是运营细节，不是终端用户操作。

## 推荐的变体策略

有两种有用的模式。

### 模式 A：每个变体的固定公共消息

对于许多变体，固定的安全消息就足够了：

```rust
impl ToErrorPresentation for OidcError {
    fn to_error_presentation(&self) -> ErrorPresentation {
        match self {
            OidcError::RedirectUrl { .. } => ErrorPresentation {
                code: "oidc_redirect_url_invalid",
                message: "登录重定向 URL 无效。".into(),
            },
            OidcError::Metadata { .. }
            | OidcError::TokenExchange { .. }
            | OidcError::TokenRefresh { .. } => ErrorPresentation {
                code: "oidc_temporarily_unavailable",
                message: "认证暂时不可用。".into(),
            },
            OidcError::CSRFValidation { .. } => ErrorPresentation {
                code: "oidc_request_invalid",
                message: "登录请求不再生效。请重新开始。".into(),
            },
            _ => ErrorPresentation {
                code: "internal_error",
                message: "请求失败。".into(),
            },
        }
    }
}
```

这是默认模式，应该覆盖大多数情况。

### 模式 B：每个实例的可选公共覆盖

某些变体需要根据确切原因使用不同的安全消息。

例如：`PendingOauth` 不应暴露原始存储错误，但它可以安全地告诉用户登录请求是缺失、过期还是已被使用。

这应该建模为结构化的原因数据，而不是通过解析 `source.to_string()`。

```rust
use std::borrow::Cow;

pub enum PendingOauthReason {
    Missing,
    Expired,
    AlreadyUsed,
}

#[derive(Debug, Snafu)]
pub enum OidcError {
    #[snafu(display("OIDC pending OAuth error: {source}"))]
    PendingOauth {
        source: Box<dyn std::error::Error + Send + Sync>,
        reason: Option<PendingOauthReason>,
        public_message: Option<Cow<'static, str>>,
    },
}
```

然后展示可以优先使用：

1. 显式安全的 `public_message`
2. 结构化的 `reason`
3. 通用回退

这为调用者提供了一种受控的覆盖机制，而不会削弱默认策略。

## 重要规则

不要从以下来源派生公共消息：

- `source.to_string()`
- 提供者响应体
- HTTP 传输错误
- 任意的底层字符串

如果底层有用户可理解的条件，首先将其提升为类型化的变体或类型化的原因枚举。

## 推荐的认证错误披露策略

SecurityDept 的推荐类别：

| 类别 | 终端用户消息风格 | 示例 |
| --- | --- | --- |
| 安全且具体 | 解释可恢复的问题 | 无效重定向 URL、登录请求过期、授权码已被使用 |
| 安全但通用 | 保持上下文宽泛 | 会话过期、需要认证、访问被拒绝 |
| 仅内部 | 从不暴露原始细节 | 元数据获取错误、内省传输故障、存储错误、加密/密封故障 |

在实践中，`redirect URL error` 和 `code invalid/expired` 属于第一类，但公共消息仍应经过规范和清理。

## 响应格式

未来的 API 响应应该优先使用结构化的错误负载，而不是单个 `error` 字符串：

```json
{
  "success": false,
  "status": 401,
  "error": {
    "code": "oidc_request_expired",
    "message": "登录请求已过期。请重新开始。"
  }
}
```

好处：

- 前端逻辑可以基于 `code` 分支
- 消息文本可以在不破坏客户端的情况下演变
- 日志单独保留完整的内部细节

如果当前响应格式必须为了兼容性保留，项目可以临时添加：

- `error.code`
- `error.message`

或扁平化为：

- `error_code`
- `error_message`

关键是停止使用 `Display` 作为公共契约。

## 日志记录指南

当返回经过清理的用户响应时，服务器仍应记录完整的内部错误链。

建议在边界处的行为：

1. 使用 `tracing` 记录内部错误
2. 将其映射到 `status`
3. 将其映射到经过清理的展示
4. 仅将经过清理的展示返回给客户端

这保持了运营效率，同时不会泄露内部细节。

## 迁移路径

SecurityDept 可以逐步采用这个方法。

### 步骤 1

在一个通用的 crate 中添加一个小型共享展示类型和 trait。

可能的位置：

- `packages/utils`
- 或者如果跨领域关注点增长，未来可以创建专用的错误 crate

### 步骤 2

首先为顶层公共错误类型实现该 trait：

- `OidcError`
- `OAuthResourceServerError`
- `CredsManageError`
- `ServerError`

### 步骤 3

更新 `apps/server/src/error.rs`，使 `IntoResponse` 使用：

- `to_http_status()`
- `to_error_presentation()`

而不是 `self.to_string()`。

### 步骤 4

通过引入类型化的原因枚举来优化认证敏感变体，特别是在以下方面：

- 待处理的 OAuth 状态查找
- 授权码交换失败
- 重定向目标验证

## 未来方向

随着项目发展到多种认证上下文模式，错误系统也应该变得具有模式感知能力。

示例：

- 基础认证区域模式可能需要浏览器安全的 challenge 和注销消息
- cookie-session 模式可能需要会话过期与需要认证的区分
- 无状态 token-set 模式可能需要令牌刷新过期与访问令牌无效的区分

同样的三层规则仍然适用：

- 内部错误语义
- 传输/状态语义
- 面向用户的展示语义

这种模型比试图将所有内容编码到一个 `Display` 字符串中具有更好的可扩展性。

---

[English](../en/005-ERROR_SYSTEM_DESIGN.md) | [中文](005-ERROR_SYSTEM_DESIGN.md)
