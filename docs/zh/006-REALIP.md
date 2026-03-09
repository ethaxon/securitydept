# Real IP 策略

本文档定义未来 `securitydept-realip` 模块的 real-IP 设计基线。

目标问题不是单一反向代理，而是多层网络边界场景，例如：

- `Client -> CDN -> origin`
- `Client -> CDN A -> CDN B -> reverse proxy -> app`
- `Client -> L4 LB -> NGINX -> Traefik -> app`

设计目标是在不信任未授权对端可伪造头的前提下，稳定解析有效客户端 IP。

## 范围

计划中的 crate：`securitydept-realip`

职责：

- 从多个来源聚合受信任 peer CIDR
- 根据传输层元数据和 HTTP 头解析有效客户端 IP
- 为 middleware 和业务层暴露确定性的解析结果
- 为远程 trusted-peer provider 提供后台刷新
- 为本地文件 trusted-peer 列表提供 watch 支持

不在范围内：

- rate limiting
- geo-IP 查询
- WAF 或 bot 检测
- 请求日志策略

## 核心模型

设计上应严格区分两个概念：

1. provider
2. source

provider 负责回答：trusted peer CIDR 从哪里来？

source 负责回答：当连接对端命中某组 trusted CIDR 后，可以接受哪些传输层或 HTTP 头输入，以及如何解析？

这样可以避免危险的全局模型，例如“永远优先信任 `CF-Connecting-IP`”或“永远使用 `X-Forwarded-For`”。

## 信任边界规则

默认安全模型应为：

1. 先检查 socket peer address
2. 用该 peer 去匹配配置中的 trusted source CIDR
3. 只有 source 命中后，才解析该 source 允许的 transport/header 字段
4. 如果没有任何 source 命中，则忽略所有 forwarded client-IP 相关头，直接使用 socket peer address

这意味着 client-IP 相关头绝不能脱离 peer 信任边界单独生效。

## Header 与传输层策略

优先级应是 source-specific，而不是全局固定值。

### 推荐顺序

在已命中的 source 内，按以下顺序使用更强的信号：

1. PROXY protocol，仅限该 trusted transport boundary 明确启用时
2. provider 专属单值头，但仅限已知是单层边缘的 source
3. 递归解析 `X-Forwarded-For`
4. 递归解析 `Forwarded`
5. 回退到 socket peer address

### `Forwarded`

`Forwarded` 是标准化头，应该支持。

但它不应成为唯一 real-IP 机制，因为很多代理和 CDN 产品在实际运维上仍主要围绕 `X-Forwarded-For` 实现 real-IP 行为。

### `X-Forwarded-For`

`X-Forwarded-For` 应作为一等链式输入支持。

它不能简单取最左或最右值。解析器应：

- 将链拆分为独立 IP 值
- 从右向左处理
- 剥离所有已知 trusted internal proxy/CDN hop
- 返回第一个 non-trusted IP 作为有效客户端 IP

这个行为与常见代理中的递归 real-IP 处理模型一致。

### `X-Real-IP`

`X-Real-IP` 不应作为公网互操作标准。

但它仍可作为内部 canonical header，由第一层 trusted reverse proxy 在外部链路已验证并归一化后向内写入。

### provider 专属头

provider 专属单值头只有在该 provider 是最外层 trusted edge 时才可靠。

例如：

- `CF-Connecting-IP` 适用于 Cloudflare 直接面对终端用户的场景。
- 当 Cloudflare 本身位于另一个 trusted CDN 或 proxy 之后时，`CF-Connecting-IP` 不足以代表最终客户端 IP。
- `EO-Connecting-IP` 不应在 stacked-proxy 场景下视为最终客户端 IP。

如果 provider 专属头的值本身又落入另一个 trusted provider 地址集合中，应把它视为“当前 source 不是最外层边缘”的信号，并继续进行链式解析。

## 多 CDN 叠加指导

对于如下链路：

`Client -> EdgeOne -> Cloudflare -> origin`

应用层不能假设 `CF-Connecting-IP` 就是最终客户端 IP。

正确处理应为：

- 先确认 socket peer 属于 Cloudflare
- 检查 `CF-Connecting-IP`
- 如果该 IP 属于另一个已配置 trusted provider 集合，则将其视为中间 trusted hop
- 继续递归解析 `X-Forwarded-For` 或 `Forwarded`
- 只有在该单值头不再指向其他 trusted provider，且 source 契约明确允许时，才直接采用

这是一种启发式保护，不是主信任模型。主模型仍然是 source-based trust 加 recursive chain parsing。

## 配置模型

推荐配置形状为：

- `providers`：定义 trusted CIDR 从哪里来
- `sources`：定义哪些 peer CIDR 命中后允许哪些解析策略
- `fallback`：定义未命中 source 时的行为

### Providers

每个 provider 应支持以下类型之一：

- `inline`
- `local-file`
- `remote-file`
- `command`
- 面向运行环境的动态 provider

建议字段：

- `name`
- `kind`
- inline provider 的 `cidrs`
- local file 的 `path`
- remote file 的 `url`
- command provider 的 `command` 与 `args`
- 远程轮询的 `refresh`
- 本地文件的 `watch` 与 `debounce`
- `timeout`
- `on_refresh_failure`
- `max_stale`

### Sources

每个 source 应支持：

- `name`
- `priority`
- `peers_from`
- `accept_transport`
- `accept_headers`

header 和 transport 输入应显式建模，而不是仅使用字符串名。尤其要区分：

- `cf-connecting-ip` 这类单值头
- `x-forwarded-for` 这类递归链式输入
- PROXY protocol 这类传输层输入

### Fallback

fallback 应显式配置为：

- `remote-addr`

这样在没有 trusted source 命中时，不会出现含糊语义。

## 动态 Provider 指导

静态 provider 不能覆盖所有部署环境。

在容器化和编排环境中，地址往往是动态分配的。因此设计上除了静态 CIDR 列表外，还应支持动态 trusted-peer 发现。

推荐的 provider 类别：

- `inline`
- `local-file`
- `remote-file`
- `command`
- 可选的环境专属 provider，例如 Docker 或 Kubernetes 集成

关键规则是：动态 provider 应发现 trusted ingress 或 proxy peer，而不是盲目信任整个容器网段或集群网段。

### Command provider

`command` provider 是最通用、可移植性最好的动态方案。

它应执行配置好的命令，将 stdout 解析为 CIDR 或单个 IP，校验结果后再原子发布新的 trusted 集合。

建议字段：

- `name`
- `kind: command`
- `command`
- `args`
- `refresh`
- `timeout`
- `on_refresh_failure`
- `max_stale`

推荐行为：

- 非零退出码视为 refresh failure
- 拒绝格式错误的输出
- 刷新失败时保留 last-known-good 集合
- 限制输出大小，避免滥用或意外膨胀

command provider 允许运维方接入自己的环境发现逻辑，而不必强迫 `securitydept-realip` 内建所有平台 API。

典型用途：

- 检查某个 Docker network 并输出当前 ingress subnet
- 查询 Kubernetes Endpoints 或 EndpointSlice 并输出 ingress controller Pod IP
- 从内部资产清单或 service-discovery 系统取回地址

### 环境专属 provider

后续 crate 可以提供一等 provider，例如：

- `docker-network`
- `docker-container-label`
- `kubernetes-pods`
- `kubernetes-endpoints`
- `kubernetes-endpointslice`

这些 provider 的职责应保持收敛。它们应解析承担 trusted gateway 职责的组件地址，例如：

- ingress controller
- reverse proxy
- edge gateway
- 显式负责 client-IP 归一化的 sidecar

它们不应默认信任：

- 全部 Pod CIDR
- 全部 Service CIDR
- 全部 Docker bridge subnet
- 全部 node private network

### 专属 Provider 扩展

对于具备稳定运维模式的部署环境，增加专属 provider 是合理的。

例如：

- 面向 managed LB inventory API 的 provider
- 面向 private edge mesh control plane 的 provider
- 面向特定内部 gateway registry 的 provider

设计上应保持 provider 接口足够窄，这样新增集成时无需修改整个解析引擎。

## 容器与编排网络

不建议信任过宽私网段，并不意味着容器化部署无法支持。

真正的含义是：信任契约必须显式化。

推荐优先顺序：

1. 信任明确的 ingress 或 gateway 地址
2. 使用动态 provider 发现这些地址
3. 只有当某个容器网络 CIDR 专门只承载 trusted proxy 基础设施时，才信任更宽的网段

可以接受的较宽信任示例：

- 仅由 ingress gateway Pod 使用的私有 overlay
- 仅由 NGINX 和 Traefik 这类前置 hop 使用的专用 Docker network

风险较高的较宽信任示例：

- 整个集群 Pod CIDR
- 整个 Service CIDR
- 一台宿主机上承载了无关工作负载的默认 Docker bridge 网段

如果确实必须信任较宽的内部 CIDR，source 最好再附加至少一个约束：

- internal-only bind address
- dedicated listener port
- PROXY protocol
- mTLS
- 由 trusted ingress tier 注入的 internal shared-secret header

对于 mixed-use internal network，仅靠 CIDR 信任通常不够强。

## 示例形状

```yaml
providers:
  - name: cloudflare-v4
    kind: remote-file
    url: https://www.cloudflare.com/ips-v4
    refresh: 6h
    timeout: 10s
    on_refresh_failure: keep-last-good
    max_stale: 7d

  - name: cloudflare-v6
    kind: remote-file
    url: https://www.cloudflare.com/ips-v6
    refresh: 6h
    timeout: 10s
    on_refresh_failure: keep-last-good
    max_stale: 7d

  - name: local-proxies
    kind: local-file
    path: ./config/trusted-proxies.txt
    watch: true
    debounce: 2s

  - name: discovered-ingress
    kind: command
    command: ./scripts/list-trusted-proxies.sh
    refresh: 30s
    timeout: 5s
    on_refresh_failure: keep-last-good
    max_stale: 10m

  - name: loopback
    kind: inline
    cidrs: ["127.0.0.1/32", "::1/128"]

sources:
  - name: cloudflare
    priority: 100
    peers_from: ["cloudflare-v4", "cloudflare-v6"]
    accept_headers:
      - kind: cf-connecting-ip
        mode: single
        use_only_if_not_in_trusted_peers: true
      - kind: x-forwarded-for
        mode: recursive
        direction: right-to-left
      - kind: forwarded
        mode: recursive
        direction: right-to-left
        param: for

  - name: internal-proxy
    priority: 50
    peers_from: ["local-proxies", "discovered-ingress", "loopback"]
    accept_transport:
      - kind: proxy-protocol
    accept_headers:
      - kind: x-forwarded-for
        mode: recursive
        direction: right-to-left
      - kind: forwarded
        mode: recursive
        direction: right-to-left
        param: for

fallback:
  strategy: remote-addr
```

## Trusted CIDR Provider 规则

trusted CIDR 不应被编译成单一静态列表。

模块应支持多个 provider，因为真实部署通常会组合：

- CDN provider 地址段
- cloud load balancer 地址段
- 运维维护的本地 proxy 地址段
- loopback 或显式允许的 direct-access 地址段

但实现上不应默认信任过宽的私网段。例如，盲目信任整个 `172.16.0.0/12` 或 `192.168.0.0/16` 通常过宽，除非这些网段只用于受信任 ingress 基础设施。

优先信任明确的 ingress/proxy CIDR，而不是整段私网。

## 刷新与监听策略

remote provider 应在后台异步刷新。

推荐行为：

- 若存在本地缓存快照，启动时优先加载
- 只有校验成功后才用原子替换应用新的 CIDR 集
- 刷新失败时保留 last-known-good 集合
- 超过 `max_stale` 时暴露 staleness 状态
- 对轮询周期加入 jitter，避免同步刷新风暴

local-file provider 应支持 watch 模式，并在 debounce 与校验成功后再替换。

推荐默认值：

- Cloudflare IP 列表：`6h` 到 `24h` 刷新
- 官方文档说明变更较慢的 provider ACL API：可用更长周期，例如 `72h`
- local file watch debounce：`1s` 到 `3s`

## 冲突处理

如果两个 source 展开后的 trusted CIDR 存在重叠，配置层不能静默“碰巧选中一个”。

推荐行为：

- 要么在启动时拒绝重叠的 source peer CIDR
- 要么要求显式 `priority`，并保证冲突解析是确定性的

静默歧义不可接受。

## API 形状

crate 应暴露适合 middleware 使用的结果对象，例如：

```rust
pub struct ResolvedClientIp {
    pub client_ip: std::net::IpAddr,
    pub peer_ip: std::net::IpAddr,
    pub source_name: Option<String>,
    pub source_kind: ResolvedSourceKind,
    pub header_name: Option<String>,
}
```

业务层应消费解析结果，而不是再次自行解析头。

## 与现有工具的边界

`packages/utils/src/base_url.rs` 中现有的 external-base-url 逻辑关注的是外部 URL 重建，不是 real-IP trust resolution。

未来的 real-IP crate 不应混淆或隐藏这一区别。

---

[English](../en/006-REALIP.md) | [中文](006-REALIP.md)
