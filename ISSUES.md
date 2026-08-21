# Harman 当前问题列表

记录时间：2026-08-21

## M7 收尾状态

本文件中的阻断项已按真实 Chromium、远程构建和最终 Core 回归重新复核。
当前结论是：代码、测试和 M7 Web 验收已收尾；GitHub 发布仍是需要额外
授权的外部工作，不能在本地仓库中宣称已完成。

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

- 个人 GitHub 可信仓库没有 remote，也没有得到 push/tag/release 授权；本地
  recipe/index/CI/release contract 已验证，但 GitHub 端到端发布不能代做。
- DSH 自己生成的缓存/`cordis.yml` 生命周期仍依赖上游契约，Harman 自有
  materialized views、stale-stage 清理和私有状态保留已经有回归覆盖。
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
  - P6 DSH 自生成缓存生命周期和 P8 GitHub 发布仍明确标为风险/外部边界。

- **GitHub 可信仓库尚未发布**
  - 当前仓库没有 Git remote。
  - recipes、index、CI 和 release artifacts 尚未在实际个人 GitHub 仓库端到端验证。

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
