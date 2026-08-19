# Harman：面向 DeepSeek Harness 的包、资源与 Profile 管理器提案

## 1. 项目定位

Harman（Harness Manager）是一个基于 DeepSeek Harness（DSH）开发的管理层扩展，目标是在尽可能保持 DSH 插件生态兼容的前提下，提供更清晰、可控、可复现的插件与 Agent 环境管理能力。

项目优先采用 fork DSH 的方式开发，尽量避免修改 Agent Runtime、Cordis 插件接口和现有插件 ABI，主要集中改造插件管理、资源管理与 Profile 管理相关部分。

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

## 6. 与 DeepSeek Harness 的关系

Harman 应尽量保持 DSH Runtime 不变。

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

主要修改或扩展：

```text
dsh plugin
包安装与版本管理
Package Store
Repository
Resource Manager
Profile 管理
配置与资源组合逻辑
```

设计原则是：

> DSH 负责“能力如何运行”，Harman 负责“运行哪些能力，以及它们如何被组织”。

这样既能快速兼容已有 DSH 插件，又能持续跟进 DSH 上游发展。

## 7. Repository

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

## 8. 项目原则

Harman 的核心原则为：

- 优先兼容 DSH，而不是重新设计 DSH。
- npm/pnpm 可以参与构建，但不应成为最终用户的包管理体验。
- Package 与 Resource 明确分离。
- 本机已有 Agent 资源无需重新打包即可被管理。
- Profile 是独立、可复现的 Agent Environment。
- Harman 只负责自己拥有的文件生命周期，不擅自修改或删除 external resource。
- 尽可能保持对 DSH 上游的薄修改，以降低长期同步成本。

## 9. 项目目标

Harman 最终希望把类似：

```text
我的 Coding 环境有哪些插件？
Writing Profile 使用哪些 Skill？
这个 AGENTS.md 被哪个环境引用？
某个 MCP 配置来自哪里？
这个插件为什么存在？
哪个版本正在使用？
更新会影响哪些 Profile？
```

这些问题变成可以由统一管理器明确回答的问题。

Harman 因此并不仅是一个 DSH Plugin Manager，而是：

> **一个以 DeepSeek Harness 为主要 Runtime，统一管理 Package、Agent Resource 与 isolated Profile 的 Harness Manager。**