# Harman：面向 DeepSeek Harness 的包、资源与 Profile 管理器提案

## 1. 项目定位

Harman（Harness Manager）是一个以 DeepSeek Harness（DSH）为主要 Runtime 的独立管理层，目标是在尽可能保持 DSH 插件生态兼容的前提下，提供更清晰、可控、可复现的插件与 Agent 环境管理能力。

项目优先保留 DSH 本体不变，在 DSH 之外实现 Package、Resource 和 Profile 控制平面，并通过版本化 adapter 与普通 DSH bridge plugin 完成运行时和 Web 集成。只有 DSH 的公开配置、Profile、Cordis Plugin 或 Web Client Plugin 边界无法满足完整需求时，才考虑维护最小、可上游化的薄 fork；Harman 的管理核心不进入 fork。

Harman 不试图重新实现一个 Harness，而是补足 DSH 当前缺少的“发行版级管理能力”。

## 2. 设计目标

Harman 主要解决三个问题：

1. DSH 当前插件管理依赖 npm/pnpm，安装、版本解析、更新、卸载和构建脚本行为较复杂。
2. 不同用途的 Harness 环境需要彻底隔离插件、配置和 Agent 资源，避免互相干扰。
3. 除 DSH Plugin 外，用户本机已有的 Skill、MCP 配置、`AGENTS.md`、Prompt 等 Agent 资源缺少统一的发现、组织和组合机制。

因此 Harman 将核心对象划分为：

- **Package**：由包管理器安装和维护的软件包，主要包括 DSH Plugin。
- **Resource**：已有的 Agent 资源，如 Skill、MCP、Prompt、`AGENTS.md` 等。
- **Profile**：Package、Resource 和配置的组合环境。

其中：

> Package 可以提供 Resource，但 Resource 不要求来自 Package。

## 3. Package Manager

Package Manager 主要负责 DSH Plugin 的搜索、安装、更新、卸载、依赖与版本管理。

交互逻辑参考 pacman：

```bash
harman -Sy
harman -Ss sidebar
harman -S dsh-better-sidebar
harman -R dsh-better-sidebar
harman -Syu
harman -Qi dsh-better-sidebar
```

Harman 使用可信 GitHub 仓库维护软件包索引、构建规则和预构建产物。

社区插件无需专门适配 Harman。对于已有 npm/pnpm 发布的 DSH Plugin，Harman 参考 AUR 的模式，通过 recipe：

1. 从 npm、GitHub 或其他上游获取源码或发布包；
2. 解析 `package.json` 和运行时依赖；
3. 必要时执行构建；
4. 收集并固化运行时依赖；
5. 重新打包为 Harman 可直接部署的软件包；
6. 通过 CI 测试后发布预构建产物。

普通用户安装时不再进行 npm/pnpm dependency resolution。

npm/pnpm 因此只是：

> **兼容的上游来源与构建工具，而不是 Harman 的包管理后端。**

必要时允许本地按 recipe 构建，以覆盖尚无预构建包的社区插件。

## 4. Resource Manager

Resource Manager 独立于 Package Manager，用于管理本机已经存在的 Agent 资源。

典型对象包括：

```text
~/.agents/skills/*
~/project/.agents/skills/*
~/project/AGENTS.md
~/prompts/*.md
已有 MCP 配置
其他可注入的 Markdown 或上下文资源
```

Harman 可以发现、登记和组织这些内容，但不要求它们转换为 Harman Package。

Resource 应区分来源与所有权，例如：

```text
external
    用户自己维护的现有文件
    Harman 只引用，不负责删除或更新

managed
    由 Harman 创建、导入或安装的资源
    Harman 可以负责其生命周期
```

Resource Manager 应支持：

```text
scan
list
show
register
adopt
enable
disable
bind
detach
```

例如：

```bash
harman resource scan
harman resource list
harman resource show skill/impeccable
```

对于 `AGENTS.md` 等项目文件，Harman 只负责记录其位置、作用域和 Profile 绑定关系，不改变其作为项目文件的所有权。

## 5. Profile

Profile 是 Harman 中真正的运行环境单位。

每个 Profile 可以拥有独立的：

```text
Packages
Resources
Plugin 配置
Prompt / Markdown 注入
MCP
模型配置
Cordis Patch
运行状态
```

例如：

```text
web
├── packages
│   ├── dsh-web-ui-all
│   └── dsh-better-sidebar
├── resources
│   ├── skill/impeccable
│   ├── skill/web-design-guidelines
│   └── mcp/browser
└── config
```

其中 Package 可以来自 Harman 仓库，而 Resource 可以直接引用：

```text
~/.agents/skills/impeccable/
~/dev/project/AGENTS.md
```

不同 Profile 之间默认互不影响。

软件包实体可存放于共享的全局只读 Store，Profile 仅保存版本选择、资源绑定和配置，从而避免重复安装。

Profile 应支持导出与恢复，以形成真正可复现的 Agent Environment。

每个 Harman Profile 使用独立的 `DSH_HOME`，而不是仅映射为同一个 `DSH_HOME` 下的不同 DSH Profile。由此隔离 DSH 的 Profile、Settings、Credentials、Session、Storage、Preset、Skill、Home 级 Cordis Patch 和其他运行状态。

DSH Runtime 默认跟随官方 `latest`：Harman 不为普通 Profile 固定 DSH 版本，也不因非破坏性上游发布维护逐版本 adapter。每个新 `latest` 通过兼容合同后直接成为默认 Runtime；只有检测到破坏性变化时，才进入兼容开发。

需要稳定复现、审计或暂缓升级的 Profile 可以显式固定 DSH 精确版本。未固定的 Profile 保存 `latest` 通道策略；导出和运行记录仍应记录当次实际解析出的 DSH 版本与产物哈希，使一次运行可追溯，同时不把该版本永久变成 Profile 的默认约束。

## 6. 与 DeepSeek Harness 的关系

Harman 默认使用官方原版 DSH Runtime，并以外置控制层的方式跟随 DSH `latest`。

优先保留：

```text
Cordis
DSH Plugin ABI
ctx.* services
Agent Loop
Tool / Skill / MCP Runtime
Session 机制
现有插件接口
```

Harman 主要在 DSH 之外实现或扩展：

```text
dsh plugin
包安装与版本管理
Package Store
Repository
Resource Manager
Profile 管理
配置与资源组合逻辑
```

Harman 将验证后的 Package 从全局只读 Store 物化到 Profile，并生成 DSH 可直接读取的 Profile manifest、`cordis.patch.yml` 与模块视图。Harman-managed Profile 不调用 `dsh plugin` 进行 pnpm dependency resolution。

DSH Runtime 本身也作为可解析的运行时对象管理：默认引用 `latest` 通道，Profile 可选引用精确版本。DSH 生成的 `cordis.yml`、安装 fallback links 和运行缓存属于可再生状态，不进入 Harman 的权威锁文件。

设计原则是：

> DSH 负责“能力如何运行”，Harman 负责“运行哪些能力，以及它们如何被组织”。

这样既能快速兼容已有 DSH 插件，又能持续跟进 DSH 上游发展。

## 7. DSH Web 可视化管理

Harman 应在 DSH Web 中提供原生可发现的可视化设置与管理入口，同时保持 CLI 和 Harman 事务 API 为行为真源。

Web 集成优先以普通 Harman bridge bundle 实现：Host 侧连接 Harman daemon/API，Client 侧通过 DSH Web Client Plugin 和 Settings slot 注册界面，不修改 DSH Web 本体。

可视化界面至少覆盖：

```text
当前 Profile 与 DSH Runtime（latest / pinned）
Package 搜索、安装、更新、卸载与影响预览
Resource 来源、所有权、启停与 Profile 绑定
Profile 创建、切换、差异、导出与恢复
Repository、签名与信任状态
运行时插件清单、诊断与漂移提示
```

浏览器端不得直接修改 Profile 文件、Store 或调用 npm/pnpm。所有写操作必须经过 Harman 的鉴权、事务、影响分析和审计接口；在 Harman daemon 不可用或状态过期时，界面应只读或明确拒绝写入。

DSH Web 不可用时，CLI、自动化 API 和 headless Profile 仍应完整工作；但 DSH Web 可视化管理本身属于项目最终交付与验收范围，不得以 CLI 已可用为由省略。

## 8. Repository

第一阶段采用个人 GitHub 仓库作为可信软件源。

仓库主要包含：

```text
recipes/
repo index
package metadata
CI build definitions
release artifacts
```

社区维护者可以为 npm 或 GitHub 上已有的 DSH Plugin 提交 recipe，而无需修改插件本身。

后续可逐步支持：

```bash
harman repo add community ...
```

以及签名、校验、多个软件源和信任策略。

第一阶段不建设类似 npm 的公共中心化 Registry。

## 9. 项目原则

Harman 的核心原则为：

- 优先兼容 DSH，而不是重新设计 DSH。
- 默认使用原版 DSH 并跟随官方 `latest`；非破坏性更新不产生逐版本适配工作，破坏性更新才触发兼容开发。
- Profile 可以显式固定 DSH 版本，但固定不是默认行为。
- npm/pnpm 可以参与构建，但不应成为最终用户的包管理体验。
- Package 与 Resource 明确分离。
- 本机已有 Agent 资源无需重新打包即可被管理。
- Profile 是独立、可复现的 Agent Environment。
- Harman 只负责自己拥有的文件生命周期，不擅自修改或删除 external resource。
- DSH Web 管理界面通过普通 bridge/client plugin 扩展，写操作统一经过 Harman 事务边界。
- 除非完整需求无法通过公开扩展边界实现，不 fork DSH；即使必须 fork，也只保留最小补丁。

## 10. 项目目标

Harman 最终希望把类似：

```text
我的 Coding 环境有哪些插件？
Writing Profile 使用哪些 Skill？
这个 AGENTS.md 被哪个环境引用？
某个 MCP 配置来自哪里？
这个插件为什么存在？
哪个版本正在使用？
更新会影响哪些 Profile？
当前 Profile 跟随 DSH latest 还是固定版本？
新的 DSH latest 是否通过兼容验证？
```

这些问题变成可以由统一管理器明确回答的问题。

Harman 因此并不仅是一个 DSH Plugin Manager，而是：

> **一个以 DeepSeek Harness 为主要 Runtime，统一管理 Package、Agent Resource 与 isolated Profile 的 Harness Manager。**
