# Harman 当前问题列表

记录时间：2026-08-21

## M7 收尾状态

本文件中的阻断项已按真实 Chromium、远程构建、DSH latest 和最终 Core 回归
重新复核。当前结论是：1.0.0-pre-2 的代码、构建和测试准备已收尾；M7
最终验收清单继续保留并按少量预发布用户口径接受，但不把旧 artifact 的
浏览器证据冒充为 pre-2 独立浏览器验收。pre-2 公开推送仍是单独的发布动作。

- P7 Client 注入问题已关闭：`apply()` 先 mount Remote，再用
  `ctx.get('remote.harman')` 读取动态命名空间；不再把本插件自己创建的
  `remote.harman` 声明为启动前置注入。
- P7 浏览器验收已关闭：真实 Chromium 验证了 Settings/Harman 入口、7 个
  面板、刷新、事务预览/提交、`STALE_REVISION`、daemon 断连只读、语义
  无障碍/键盘焦点和 390px 响应式布局。证据见
  `evidence/M7/20260821T064247Z-web-final/manifest.json`。
- Solver 循环依赖诊断和 Store 引用感知 GC 已纳入最终 65 项 Core 回归；本机
  之前记录的 Node `InternalCallbackScope::Close` 本轮没有复现。
- M7 还记录了 Host/Client 构建要求：上游 DSH 根 `tsconfig.host.json` 与
  `tsconfig.client.json` 都必须引用 bridge 子项目；说明见
  `docs/maintainers/upstream-sync.md`。

仍未关闭的边界：

- 公开 `locked-fog/harman` 仓库和 pre-1 基线已经存在于 `origin`；本轮 pre-2
  工作树尚未推送，Hosted CI 的 pre-2 运行和公开 raw artifact 端到端核验
  仍是发布动作。
- DSH 自己生成的缓存/`cordis.yml` 生命周期已按 latest 上游观察结果记录为
  契约：DSH 重写派生 root，Harman 只拥有 patch 输入和 materialized view，
  私有 cache 不进入 Harman lock；本机和 codex-test 均有对应回归，未来
  upstream 改变路径或写入时机时必须重新验证。
- `@deepseek-ai/dsh-type-meta` 仍未在 npm 发布，但 pre-2 已切换到同一 DSH
  release family 的 protocol-native Typert 输出；构建期不再生成该包的
  临时 facade。
- Headless Chromium 记录到一个上游页面的非阻断 DOM 建议（密码输入框未被
  form 包含）；没有 JavaScript exception，Harman bridge 加载和操作均通过。

## 产品与验收问题

- **P7 Web Bridge：Client 注入声明错误（已关闭）**
  - 在测试机真实 Chromium 页面加载时，`@harman/dsh-bridge` 失败。
  - 原始 DSH 报错：`cannot get property "remote.harman" without inject`。
  - 已改为在自身 Remote mount 完成后通过 `ctx.get('remote.harman')` 读取。

- **P7 浏览器验收（已关闭）**
  - 真实 Chromium 已完成真实加载、Settings 入口、全部管理面板、事务预览/提交、过期 revision、断连只读、键盘/无障碍、响应式和刷新一致性验证；详细命令及 SHA-256 在 M7 manifest。

- **需求追踪表（已更新，保留真实未决边界）**
  - P1 外置控制面、P5 composition merge、P7 Web 和 P9 覆盖项已关联 M7 证据。
  - P6 DSH 派生状态和 P8 pre-2 公开推送仍明确标为外部发布边界。

- **GitHub 可信仓库（本次发布准备中）**
  - 公开仓库已经创建；pre-2 提交、recipes、index、CI 和 release artifacts
    需要在推送后用公开 raw URL 和 Hosted CI 结果完成端到端核验。

- **1.0.0-pre-2 四项适配问题（实现已完成，证据已分层）**
  - Session `JsonValue`：Bridge 保留本地递归根，并对官方 Session 类型做双向
    可赋值断言；官方类型漂移会使构建失败。
  - Typert generator/protocol：构建器先解析 DSH，再按 release family 解析
    generator、protocol、Session 和客户端支持包；个别 npm `latest` 不再混用。
  - DSH cache/`cordis.yml`：记录了 stock DSH 的派生 root 重写契约和 Harman
    保留边界；cache 只作为可重建私有状态。
  - 升级/卸载/社区插件/非 Harman 路径：本机 66/66、codex-test sandbox
    66/66，并有独立 DSH latest profile/community dump 和用户 prefix 回归。

- **M7 最终远程证据（已归档）**
  - `evidence/M7/20260821T064247Z-web-final/` 包含 manifest、摘要、浏览器结果和截图；大型日志仍保留在测试机 `~/test-work/harman/`。

## 工程验证问题

- **本机 Node 运行时不稳定（本轮未复现）**
  - 本轮 `npm test`、单文件测试和语法检查均通过；历史 `InternalCallbackScope::Close` 记录保留为环境风险，不再作为本轮失败证据。

- **循环依赖改动（已纳入收尾提交）**
  - `packages/core/src/solver.js` 和 `packages/core/test/m2-foundations.test.js` 已通过稳定结构化诊断测试，并随收尾提交保存。

## 测试环境残留（非产品缺陷）

- 远程 Harman/DSH daemon、DSH Web 和 Chromium 已按精确 PID 清理；最终复核未发现匹配进程，M7 disposable 日志/截图仍保留。
- 测试机为本次验收安装的 Chromium 仍保留；对应 Snapper 快照为 47，pacman 自动快照为 48、49。
- 远程 `~/test-work/harman` 为可丢弃工作区，仍保留 M7 日志、截图和临时源码副本，未删除以保留失败证据。
