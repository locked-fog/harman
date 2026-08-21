# M7 Web final acceptance

时间：2026-08-21 14:24–14:47（Asia/Shanghai）
测试机：`codex-test` / `archgo` / `codexlab`
源码基线：`WORKTREE-on-12c98fd`，测试源代码 patch SHA-256 为
`e78f36303fe1c3f645904dc8c8beaa9f2cb7bd892ec85eee13cfc7392e352bd2`。

## 结论

M7 代码与验证范围通过。最终 Chromium 使用 stock
`@deepseek-ai/dsh@0.1.0-rc.7`，加载 `@harman/dsh-bridge@0.1.0-dev.6`，并在
Harman Settings 中完成了真实页面加载、面板遍历、事务提交、过期 revision、
daemon 断连和 UX 探针。

关键结果：

- `npm test`：65/65；M2 单文件回归：12/12；远程 `npm run check`：65/65；
- Client build 通过，发布包 SHA-256：
  `ebc2ac8727853a258066aa944e97dc3633851956cf979ff3af886b6dd2ae6a9a`；
- Web 初始状态为 `Daemon ready`，Runtime 为 `0.1.0-rc.7 compatible`，
  repository/package/profile 均可见；
- 事务预览显示 expected revision，提交后 revision 递增并写入 audit；
- 外部 mutation 后，提交显示
  `STALE_REVISION: state revision changed`，pending action 清除且 Profile 未被
  错误停用；
- daemon socket 不可用时显示 `Read-only` 并禁用所有写操作；
- UX 探针为 0 个无标签控件、`main` landmark 存在、状态区
  `aria-live=polite`、刷新按钮可获得焦点、390px 宽度无横向溢出。

## 证据文件

本目录中的浏览器 JSON、截图、最终 repository index 和 bridge artifact 是
紧凑复核材料。完整构建/运行日志仍保留在测试机
`~/test-work/harman/`，manifest 记录了每个日志的 SHA-256。远程测试机结束
时已停止本轮创建的 DSH/daemon/Chromium 进程；Profile materialize 后的
`profile doctor` 为 `ok: true`。

## 未决边界

GitHub 发布没有执行，因为仓库没有 remote 且没有 push/tag/release 授权；这
不影响本地 recipe/index/CI/release contract 的验证。另有上游 DSH 自生成缓存
生命周期、独立硬件屏幕阅读器运行和 P9 多文件事务参与者，均在 manifest 中
保留为明确风险，没有被静默标成完成。
