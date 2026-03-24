# 路线图

本路线图与当前项目目标保持一致：将 SecurityDept 转变为面向网格的认证和授权工具包，`apps/server` 作为试验场。

## 阶段 1：底层验证和提供者层

1. 完成并加强底层 creds 验证
   - 基础认证
   - 静态令牌
   - RFC 9068
   - JWT 和 JWE 助手
2. 完成并加强共享提供者运行时
   - 发现刷新
   - JWKS 刷新
   - 内省复用
   - 严格元数据解析行为

状态：

- 大部分已实现

## 阶段 2：令牌获取和验证层

3. 加强 `securitydept-oidc-client`
   - 回调流程
   - 刷新
   - 声明规范化
   - 下游认证上下文模式的可复用接口
4. 加强 `securitydept-oauth-resource-server`
   - JWT/JWE/不透明验证
   - 策略配置
   - 共享提供者复用
   - 显式主体提取

状态：

- 大部分已实现

## 阶段 3：认证上下文模式

5. 实现基础认证区域模式
   - 后端路由助手
   - 文档化流程
   - 轻量客户端 helper，用于 zone-aware 的 `401 -> login` 跳转与 logout URL 处理
6. 实现 cookie-session 模式
   - 可复用后端认证上下文提取
   - 规范化主体形状
   - 可选重定向助手 SDK
7. 实现无状态 token-set 模式
   - token snapshot / delta 与 metadata snapshot / delta
   - 前端令牌生命周期规则
   - 多提供者令牌管理
   - 同资源转发的 bearer 传播策略
   - 可选的未来令牌交换钩子

状态：

- 基础认证区域：已文档化，未完全产品化
- cookie-session：参考实现已存在，可复用提取已落在 `securitydept-session-context` 和 `securitydept-auth-runtime`
- 无状态 token-set 模式：服务端与共享 crate 基本落地，路由编排已落在 `securitydept-auth-runtime`，browser-owned client SDK 基线也已在 `sdks/ts` 中实现；mixed-custody / BFF / server-side token-set 继续留在后续范围

## 阶段 4：前端 SDK

8. 提供轻量级 TypeScript SDK
   - 基础认证区域 helper，用于 zone 边界识别、`401 -> login` 跳转与 logout 重定向
   - cookie-session 重定向助手
   - 无状态 token-set SDK 用于令牌存储、头注入、后台刷新和登录重定向

状态：

- TypeScript 客户端 SDK 已不再只是架构草案；foundation、auth-context roots、`./web` adapter、React adapter 与 reference app dogfooding 基线都已落地
- 当前已具备 external-consumer scenario、token-set web focused lifecycle baseline、以及最小 React adapter focused test
- 当前阶段的重点不再是“是否开始实现 SDK”，而是冻结 `stable / provisional / experimental` 语义、明确 token-set v1 scope baseline，并继续积累 adopter-facing clarity
- mixed-custody、stateful BFF、server-side token-set、OTel / DI 等更高复杂度主题继续放在后续阶段，而不是当前前端 SDK 主线

参考：

- [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md)

## 阶段 5：本地凭证操作

9. 继续发展 `securitydept-creds-manage`
   - 简单基础认证和静态令牌管理
   - 操作支持场景，如 Docker 注册表登录管理

状态：

- 已实现且已有用

## 阶段 6：参考应用验证

10. 保持 `apps/server` 作为组合场景的试验场
    - 底层验证原语
    - 基础认证区域模式
    - cookie-session 模式
    - 无状态 token-set 模式
    - creds-manage 集成

当前现实角色：

- 验证环境
- 私有 Docker 注册表镜像场景的认证入口
- cookie-session、基础认证区域和无状态 token-set 流程的集成试验场

## 跨领域优先事项

- 定义共享认证主体抽象
- 保持 `oidc-client` 和 `oauth-resource-server` 分离
- 保持认证上下文模式在底层之上
- 清晰记录 bearer 转发边界
- 随着新模式的实现添加更多集成测试

---

[English](../en/100-ROADMAP.md) | [中文](100-ROADMAP.md)
