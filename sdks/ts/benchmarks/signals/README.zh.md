# Signal 基准

这里是长期维护并纳入 Git 的基准源码；生成的结果、打包文件和采样数据只放在忽略的 `temp/signal-benchmark/`。实验内核不属于正式套件。

在仓库根目录使用 `mise.toml` 指定的工具链：

```sh
mise exec -- pnpm bench:sdks
mise exec -- pnpm test:sdks
# 筛选耗时场景、对比已保存的 Vitest 结果。
mise exec -- pnpm bench:sdks -t 'diamond|dynamic-dependencies'
mise exec -- pnpm bench:sdks --compare "$PWD/temp/signal-benchmark/previous.json"
# 明确指定历史 Signal 源码基线。
SIGNAL_BASELINE=<commit> mise exec -- pnpm bench:sdks
```

`sdks/ts/vitest.config.ts` 统一组织普通 SDK 与 Signal 项目，`vitest.bench.config.ts` 使用已安装的 Vitest 4 API：`bench`、`benchmark.include`、`includeSamples`、`outputJson`；参考 [Vitest benchmark 配置](https://vitest.dev/config/benchmark)，在线新版文档可能包含当前版本尚无的 API。耗时基准串行执行，诊断检查纳入普通 SDK 测试；使用 `pnpm --filter @securitydept/ts-sdks exec vitest bench --config vitest.config.ts` 进入 watch 模式。使用 `--compare` 前先保存旧的 `vitest.json`，避免覆盖。

- `signals.bench.mjs`：25 项耗时场景，覆盖状态、缓存/失效 computed、动态依赖、深/宽/菱形/分层图、创建、无关写入、同步 watch、合并/微任务 watch 与 lossless Rx。每次 Tinybench 调用执行 **256 次操作**以摊薄计时开销，报告延迟/吞吐量以整个 batch 为单位；每项预热 150 ms、测量 500 ms。断言与清理在计时外执行。
- `diagnostics.test.mjs`：五个适配器的工作量正确性、每个适配器四项保留内存场景，以及生产 GC 检查。内存/GC 使用带 `--expose-gc` 的独立 Node 进程，不作为耗时基准。内存每样本保留 30,000 项、采三次；GC 每轮丢弃 20,000 个 computed、重复四轮，一半先订阅再退出，要求至少 99% 回收且 live 值正确。
- `setup.mjs`：复用已有 tsdown 工具链，以 ES2022 打包 Git 基线（默认 `HEAD`）和工作区源码，将提交、源码/bundle/锁文件散列与环境写入 `metadata.json`。两者共享当前辅助模块和依赖，属于单模块比较；提交改动后应指定原基线提交。
- `adapters.mjs` / `cases.mjs`：共享 [js-reactivity-benchmark](https://github.com/transitive-bullshit/js-reactivity-benchmark) 风格的框架无关适配器与场景。固定版本的 Alien、signal-polyfill、Preact 放在私有 `sdks/ts/benchmarks` workspace 包的开发依赖中。不支持的通知契约在计时套件中明确跳过，仅对支持的实现检查。

输出为 `vitest.json`、`metadata.json`、`diagnostics.json`。保留内存包含包装与数组，不是原生节点大小或分配速率；强制 GC 前跨 event-loop turn。测量时不要并行构建/测试，小差异须独立重跑。Vitest/Tinybench 与归档的自制运行器采样方法不同，结果不能直接混用；不同适配器的 watch/effect、相等写入保证不同，不能据此推断认证吞吐量、浏览器延迟、通用排名或完整 TC39 conformance。

## 实现选择

保留单一 RxSignal：原始值存储、按需 Rx 值镜像、原生 dirty 回调与 Map 快照内核。保留 public API、现有 lossless Rx 语义、同步深度优先执行顺序及外部/公开 dirty observable 协议。内核迁移还须保留自动回收能力；已否决的实验及测量收益精炼记录于根 changelog。

`bench:sdks` 后直接追加 Vitest 筛选参数；`test:sdks` 后加 `--` 将参数交给 Turbo 下的测试，例如 `pnpm test:sdks -- -t 'memory-|collectible'`。仅检查基准诊断项目时使用 `pnpm --filter @securitydept/ts-sdks test --project signals`，pnpm 会直接传递脚本参数。

[English](README.md) | [中文](README.zh.md)
