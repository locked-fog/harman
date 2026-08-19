# Harman 项目开发方案

## 0. 方案约束与完成定义

本项目的必须达成目标是：**完整实现 `proposal.md` 中描述的全部内容**。阶段性原型、可运行演示、部分 CLI、单一 Profile 或只支持预构建包，均不得被认定为项目完成。

本方案遵守以下执行约束：

1. 当前本地仓库是唯一权威源码仓库；测试机工作区是可丢弃副本。
2. 所有测试、构建验证、运行验证、性能验证、系统集成测试和源码分析均在指定测试机完成。本地仅进行源码/文档编写、Git 版本管理以及测试证据归档。
3. 涉及测试机系统包、`/etc`、`/usr`、systemd、内核或其他系统级状态变更前，必须验证 Snapper 配置并创建恢复快照。
4. 在开发正式开始前，必须取得明确的测试机 SSH host/alias；所有 SSH/SCP 调用显式使用 `/home/Locked_Fog/.ssh/config`、批处理认证和主机密钥验证。
5. 优先 fork DeepSeek Harness（下称 DSH），将修改限制在插件、包、资源、Profile 与配置组合相关边界；除非远程源码分析证明不可避免，不修改 Agent Runtime、Cordis 插件接口、现有插件 ABI、Agent Loop、Tool/Skill/MCP Runtime、Session 语义。
6. 不建设类似 npm 的公共中心化 Registry；npm/pnpm 只作为兼容上游来源与构建工具，不作为最终用户机器上的依赖解析后端。
7. 本轮只产出并提交开发方案，不创建业务源码、测试源码、脚手架、CI 配置或远程构建产物。

项目只有在第 13 节全部验收项通过并形成可复查证据后，才可宣告完成。

## 1. 需求基线与范围

### 1.1 必须交付的能力

| 提案范围 | 必须交付结果 |
| --- | --- |
| DSH 兼容 | 可持续跟进上游的 DSH fork；既有插件 ABI、Cordis 服务和 Runtime 行为通过兼容性回归 |
| Package | 搜索、安装、更新、卸载、查询、依赖/版本解析、预构建部署、本地 recipe 构建 |
| Repository | 可信个人 GitHub 软件源、recipes、索引、元数据、CI 构建、发布产物；随后支持多软件源、签名、校验和信任策略 |
| Resource | 对 Skill、MCP、Prompt、`AGENTS.md` 与其他上下文资源执行发现、登记、组织、启停、绑定、解绑和所有权管理 |
| Profile | 独立组合 Packages、Resources、插件配置、Prompt/Markdown、MCP、模型配置、Cordis Patch 和运行状态 |
| 可复现性 | Profile 锁定版本与资源身份，可导出、校验、恢复，并能在干净测试环境重建等价 Agent Environment |
| 可解释性 | 能回答插件/资源来自哪里、为何存在、被哪些 Profile 使用、当前版本、升级影响范围等问题 |
| 生命周期安全 | Harman 仅删除或更新 managed 对象；external 对象只引用，任何卸载/清理均不得越权修改 |

### 1.2 明确非目标

- 不重新实现 Harness Runtime。
- 不要求社区 DSH Plugin 专门适配 Harman。
- 不要求用户把已有 Agent Resource 转换为 Package。
- 不把 npm/pnpm 的在线 dependency resolution 暴露为普通安装流程。
- 不在第一阶段建设公共中心化 Registry。
- 不以共享可写的插件目录实现 Profile；共享 Store 必须对 Profile 只读，状态写入 Profile 私有区域。

### 1.3 需求追踪规则

建立 `docs/requirements/traceability.md`，为 `proposal.md` 每一节分配稳定编号（如 `P3-PKG-INSTALL`、`P4-RES-OWNERSHIP`、`P5-PROFILE-EXPORT`），并链接到：

- 设计文档；
- 实现模块；
- 自动化测试；
- 测试机证据；
- 用户文档；
- 完成状态与未决风险。

任何需求没有对应实现和远程验收证据，整体项目状态都必须保持“未完成”。

## 2. 前置调研阶段（仅测试机）

正式编码前，在 `~/test-work/harman` 建立测试机工作目录和独立 Git 仓库，用于保存可丢弃的分析脚本、上游检出和命令日志；不得把它当作权威源码。

### 2.1 测试机预检

记录以下信息到 `evidence/baseline/`：

- 主机名、用户、内核、发行版、CPU 架构、文件系统；
- `git`、Node.js、npm、pnpm 及 DSH 所需工具版本；
- `sudo -n true` 结果；
- Snapper 配置与 root 快照列表；
- 工作目录可写性、可用空间和网络访问边界。

预检阶段只执行只读命令和用户目录内建仓；不安装软件，不创建系统快照。需要安装/升级系统包时另开有快照保护的测试批次。

### 2.2 DSH 上游源码分析

在测试机固定具体上游 commit，产出 `docs/research/dsh-baseline.md` 和机器可读清单，至少确认：

1. DSH 仓库布局、构建系统、包管理器和发布方式；
2. 插件发现、安装、加载、启停、更新和卸载的完整调用链；
3. `package.json`、Cordis、`ctx.*` 服务、插件 ABI 与运行时依赖的真实契约；
4. Tool、Skill、MCP、Prompt、Session、模型配置和 Cordis Patch 的存储与加载入口；
5. 用户级/项目级配置位置、优先级、写入行为与迁移行为；
6. 可保持不变的 Runtime 边界，以及每个不可避免改动的理由；
7. 既有测试、样例插件和兼容性基线；
8. 上游同步时容易冲突的文件和可抽离的 Harman 扩展点。

分析结论必须引用固定 commit、文件路径和行号，不使用浮动分支作为证据。

### 2.3 生态样本分析

选择具有代表性的公开 DSH Plugin 样本，在测试机分析并保存来源版本：

- 纯 JavaScript、TypeScript 构建、含运行时依赖、含 optional/peer dependency；
- npm 发布、GitHub release、仅 GitHub 源码；
- 有 lifecycle/build script、原生扩展、资源文件、Cordis Patch 的插件；
- 正常、缺失元数据、依赖冲突、恶意路径或不可复现构建等负面样本。

样本调研用于定义 recipe/package 格式，不能以修改样本插件换取兼容性。

### 2.4 调研退出门槛

- DSH 固定基线与目标支持版本已写入决策记录；
- ABI/Runtime 不变边界有可执行回归基线；
- Package、Resource、Profile 所需集成点均找到且有证据；
- 未决问题已分为阻断项、可延后项和风险接受项；
- 只有通过评审后才进入实现阶段。

## 3. 总体架构

采用“上游兼容层 + Harman Core + 前端适配层”的分层结构：

```text
CLI / DSH UI / Automation API
              |
        Harman Application
              |
  +-----------+------------+
  | Package   | Resource   | Profile
  | Manager   | Manager    | Manager
  +-----------+------------+
              |
  Transaction / Policy / Query / Audit
              |
  Repo Cache | Package Store | State DB | Profile Dir
              |
        DSH Compatibility Adapter
              |
 Cordis / Plugin ABI / Agent Runtime / Session
```

### 3.1 建议仓库布局

最终布局以远程 DSH 源码分析为准，预期包括：

```text
apps/                 CLI 和可选管理 UI
packages/core/        领域模型、事务、查询、策略
packages/pkg/         recipe、求解器、归档、Store、部署
packages/resource/    扫描器、登记、所有权、绑定
packages/profile/     Profile 锁文件、组合、导出、恢复、启动
packages/dsh-adapter/ DSH 薄适配与兼容性边界
schemas/              recipe/index/lock/export 的版本化 schema
recipes/              第一方维护的包构建规则
docs/                 设计、ADR、威胁模型、迁移和用户手册
tests/fixtures/       合法与恶意样本（只在测试机执行）
evidence/             脱敏后的远程验收摘要与校验值
```

若 fork 的上游结构不适合此布局，使用 ADR 记录替代方案，但不得牺牲模块边界和需求追踪。

### 3.2 状态分区

概念上分为：

- Repository Cache：索引、签名、recipe 元数据和下载缓存；
- Immutable Package Store：按内容哈希保存已验证包实体；
- State Database：包、资源、Profile、引用关系、事务和审计记录；
- Profile Directory：锁文件、配置、运行状态和物化视图；
- External Resource：只保存 canonical path、作用域、身份指纹和可用性状态，不复制所有权；
- Managed Resource：保存 Harman 管理副本、来源、版本和生命周期记录。

所有格式必须有 schema version 和迁移机制。状态更新使用锁、临时文件、fsync/原子替换或等价事务机制，避免中断后出现半安装状态。

## 4. 领域模型与不变量

### 4.1 Package

Package 记录：规范名称、版本、架构/平台、DSH 兼容范围、来源、recipe revision、构建输入、依赖、提供的 Resource、内容哈希、产物签名、许可证与安装原因。

必须区分安装原因：

- explicit：用户直接选择；
- dependency：依赖求解引入；
- profile：某 Profile 锁定；
- build：仅构建时使用。

核心不变量：同一 Store 对象不可原地修改；Profile 只引用已验证版本；仍被 Profile 或其他包引用的对象不得删除；升级前必须可计算受影响 Profile。

### 4.2 Resource

Resource 使用稳定 URI 标识，例如 `skill/impeccable`、`mcp/browser`、`agents/project-x`，并记录：

- 类型、显示名、canonical path/配置键；
- `external` 或 `managed` 所有权；
- 用户级、项目级或其他作用域；
- 来源、内容身份/指纹、可用性；
- 提供它的 Package（可空）；
- 绑定它的 Profile 集合；
- 启用状态、冲突与优先级。

核心不变量：Package 可以提供 Resource，但 Resource 不依赖 Package；`external` 永不被 adopt 以外的隐式操作改写所有权；`detach` 只移除关系；删除 Profile/Package 不得删除 external 文件。

### 4.3 Profile

Profile 记录用户声明和求解后的锁定结果：

- Package 约束与精确版本；
- Resource 引用、作用域和身份指纹；
- 插件配置；
- Prompt/Markdown 注入顺序；
- MCP 配置；
- 模型配置；
- Cordis Patch；
- 运行状态与最后一次物化结果。

核心不变量：Profile 默认隔离；共享 Store 只读；写状态不得串入其他 Profile；导出不携带秘密值，而使用显式 secret reference；恢复时对缺失 external resource 给出可操作错误，不擅自创建或覆盖原路径。

### 4.4 引用图与解释查询

统一维护 `Package -> Resource -> Profile -> Config/Runtime` 引用图，为以下问题提供稳定查询：

- 某包为何安装、由谁依赖、被哪些 Profile 使用；
- 某资源来自何处、归谁所有、绑定到哪些 Profile；
- 当前运行 Profile 使用哪些精确版本；
- 升级/卸载会影响哪些 Profile 和资源；
- 某 `AGENTS.md`、MCP 或 Prompt 如何进入最终运行环境。

所有变更命令先生成 impact plan；破坏性或跨 Profile 操作必须显式确认或使用非交互确认参数。

## 5. Package Manager 实施计划

### 5.1 软件源与索引

第一阶段实现可信个人 GitHub 软件源，包含：

- 版本化 repository index schema；
- 包名、版本、DSH 兼容性、平台、依赖、产物 URL/哈希、recipe 来源；
- 条件请求、离线缓存、过期策略和原子更新；
- `harman -Sy` 同步；
- `harman -Ss <query>` 搜索；
- 损坏、回滚、重放、镜像不一致和网络中断处理。

最终阶段增加 `harman repo add/remove/list/priority`、多源优先级、命名冲突规则、签名验证、密钥轮换/撤销、每源信任策略与显式不信任状态。它们属于提案最终范围，不能永远留在“未来工作”。

### 5.2 Recipe 与构建流水线

定义声明式、版本化 recipe：

- 上游类型与固定版本/commit/tarball；
- 下载地址和校验；
- npm/pnpm 元数据解析策略；
- build/runtime/optional/peer dependency 分类；
- 受控构建步骤、允许的输出和网络策略；
- DSH 兼容约束、平台约束、许可证；
- 包含/排除规则和最终清单。

CI 在隔离构建环境中获取上游、验证输入、执行必要构建、收集并固化运行时依赖、去除构建期垃圾、生成 SBOM/清单、打包、签名并执行兼容性测试。构建脚本默认不可信，必须限制权限、网络、环境变量、文件系统和输出路径。

普通用户优先下载预构建产物，不运行 npm/pnpm dependency resolution 或 lifecycle scripts。缺少产物时可显式请求本地 recipe 构建；本地构建也必须进入隔离环境并生成相同格式、来源与验证记录。

### 5.3 依赖求解与事务

实现可解释的版本求解：

- 语义版本/精确版本约束及 DSH 兼容约束；
- 传递依赖、冲突、替代/provides（若调研确认需要）；
- 多 Profile 共同引用和并存版本；
- downgrade、pin/hold、orphan 和循环依赖诊断；
- 确定性求解结果和 lock 记录。

安装事务依次执行：同步/选取元数据、求解、输出 impact plan、下载、校验、解包到临时目录、验证 manifest、原子加入 Store、更新引用、物化受影响 Profile、提交数据库。任一步失败都不得留下可见半状态。

### 5.4 Pacman 风格 CLI

至少实现并文档化：

```text
harman -Sy
harman -Ss <query>
harman -S <package...>
harman -R <package...>
harman -Syu
harman -Qi <package>
```

同时提供脚本友好的长选项/子命令、稳定退出码、JSON 输出、`--dry-run`、非交互模式和错误分类。`-R` 必须先报告 Profile 影响；`-Syu` 必须支持预览、锁定和失败回滚。

## 6. Resource Manager 实施计划

### 6.1 扫描与适配器

为以下来源建立可扩展 scanner adapter：

- `~/.agents/skills/*`；
- 项目 `.agents/skills/*`；
- 项目 `AGENTS.md`；
- 用户 Prompt/Markdown 目录；
- 已有 MCP 配置；
- 经 schema 登记的其他可注入上下文资源。

扫描只读、幂等，不遍历越出允许根目录的符号链接，不读取 secret value，不自动 adopt，不因资源暂时离线就删除登记。

### 6.2 资源命令

完整实现：

```text
harman resource scan
harman resource list
harman resource show <resource>
harman resource register <type> <location>
harman resource adopt <resource>
harman resource enable <resource> [--profile ...]
harman resource disable <resource> [--profile ...]
harman resource bind <resource> --profile ...
harman resource detach <resource> --profile ...
```

为类型冲突、名称冲突、路径消失、指纹变化、权限不足、重复登记、作用域冲突提供明确状态。`adopt` 是唯一把 external 转为 managed 的显式流程，必须展示复制/迁移目标、影响和回退方案。

### 6.3 所有权保护

所有删除和更新逻辑基于所有权而非路径猜测：

- external：只修改 Harman 的引用/绑定/状态记录；
- managed：只处理 Harman 管理根内且 manifest 归属匹配的对象；
- Package-provided：随 Store 引用计数管理，不直接改写 Store；
- `AGENTS.md`：保持项目文件所有权，只登记位置、作用域与 Profile 绑定。

负面测试必须证明卸载包、删除 Profile、detach、数据库恢复和异常中断均不会修改 external 内容。

## 7. Profile Manager 实施计划

### 7.1 生命周期

实现 `create/list/show/clone/rename/delete/diff/activate/deactivate/run/export/import/restore/doctor`。Profile 创建后拥有独立目录和 schema 版本；删除前展示 Package/Resource 影响，但只释放引用和 Harman 自有状态。

### 7.2 组合与冲突规则

定义确定性的合并顺序和冲突语义：

1. DSH 安全默认值；
2. Profile 基础配置；
3. 锁定 Package 提供的配置/Resource；
4. 显式绑定 Resource；
5. 用户允许的运行时覆盖。

Prompt/Markdown、MCP 名称、模型配置、插件配置、Cordis Patch 出现冲突时，不得静默覆盖；必须按 schema 合并或报告需用户选择的冲突，并把最终来源链暴露给 `show/explain`。

### 7.3 隔离与 DSH 启动

通过测试机上的 DSH 集成分析选择环境变量、显式路径注入、只读链接树或其他最薄机制，确保：

- 不同 Profile 的插件选择和版本互不污染；
- 配置、MCP、Prompt、模型配置、Cordis Patch、缓存和运行状态按定义隔离；
- 共享 Store 不可被插件直接改写；
- 并行运行两个 Profile 不发生锁或状态串扰；
- 不激活 Profile 时不破坏既有 DSH 用户环境。

### 7.4 导出与恢复

设计版本化、可审计的 Profile bundle/manifest，包含精确 Package 版本、仓库身份、产物哈希、recipe revision、Resource 标识/指纹/作用域、配置和秘密引用。支持：

- 人类可读导出和机器可验证 lock；
- 在同机和干净测试机恢复；
- 缺失软件源、包版本、external resource、秘密或平台不兼容时给出差异；
- 离线恢复（在产物缓存完整时）；
- schema 迁移、向前兼容拒绝和恢复结果 diff。

“可复现”以恢复后的解析结果、包内容哈希、资源绑定和最终 DSH 运行清单等价为准，不仅是导入命令成功。

## 8. DSH 集成与上游同步

### 8.1 薄修改策略

优先顺序：

1. 使用 DSH 已有公开服务/配置入口；
2. 新增独立 Harman service/plugin；
3. 在插件管理层引入 adapter；
4. 最后才对 Runtime 增加最小、可上游化的扩展点。

每项 fork patch 都建立 ADR，记录原因、影响 ABI、替代方案、对应上游文件以及重新基于新版本时的验证方式。

### 8.2 兼容性合同

建立固定的 compatibility suite：

- 未经修改的社区 DSH Plugin 可发现、加载、调用、停用和卸载；
- `ctx.*` 服务和 Cordis 生命周期保持行为；
- Agent Loop、Tool、Skill、MCP、Session 与模型配置基线不退化；
- 现有 DSH 配置可只读发现并通过明确迁移流程接入；
- Harman Profile 不激活时原始 DSH 行为可预测。

### 8.3 上游同步流程

维护 upstream remote 与 Harman patch queue，按计划同步 DSH release/security fix。每次同步在测试机执行：基线测试、patch 重放、ABI 比较、生态样本回归、Profile 恢复回归；不通过则不得更新支持矩阵。

## 9. 安全、完整性与隐私

开发前建立威胁模型，覆盖恶意 repository/index/recipe/tarball/plugin、路径穿越、符号链接逃逸、构建脚本、依赖混淆、降级/重放、签名密钥撤销、配置注入、secret 泄露和外部资源误删。

强制控制包括：

- 下载哈希与最终 manifest 双重校验；
- 安全解包和规范路径检查；
- 不以 root 运行普通构建或 DSH 插件；
- 构建隔离、最小网络和最小环境；
- secret reference 与可导出配置分离；
- Store 只读、权限检查和内容寻址；
- 签名链、信任策略、撤销与审计；
- 事务日志不记录 token、私钥或 MCP secret；
- 所有生命周期动作生成审计事件。

安全测试和恶意 fixture 只能在测试机隔离工作区执行；涉及系统配置的测试批次先创建 Snapper 快照。

## 10. 测试与证据策略（全部在测试机执行）

### 10.1 测试层级

| 层级 | 验证内容 | 主要证据 |
| --- | --- | --- |
| Schema/单元 | 解析、求解、引用图、合并、迁移、策略 | 结构化测试报告、覆盖率 |
| 组件 | Repo、recipe、Store、Resource scanner、Profile materializer | 固定 fixture 与黄金输出 |
| 集成 | CLI 到状态库/文件系统/DSH adapter 的事务 | 命令日志、状态 diff、哈希 |
| DSH 兼容 | ABI、Cordis、Plugin、Agent/Tool/Skill/MCP/Session | 固定上游 commit 回归报告 |
| 端到端 | 安装包、绑定资源、运行 Profile、升级、导出恢复 | 全流程日志和最终运行清单 |
| 故障注入 | 断网、进程终止、磁盘满、坏索引、坏签名、并发 | 失败前后不变量与恢复证据 |
| 安全 | 穿越、symlink、恶意脚本、secret、external 保护 | 负面测试报告 |
| 性能 | 大索引、大 Store、大量 Profile/Resource、冷/热启动 | 基线、阈值和趋势 |
| 系统集成 | 安装/升级/卸载、权限、必要时重启 | Snapper 编号、包/服务状态 |

### 10.2 强制端到端场景

1. 从空状态同步仓库、搜索并安装预构建插件，无 npm/pnpm 用户侧求解。
2. 按 recipe 本地构建缺少预构建产物的插件，结果进入同一验证/Store 流程。
3. 两个 Profile 使用同包不同版本并发运行，配置和状态互不污染。
4. 扫描用户级 Skill、项目级 Skill、`AGENTS.md`、Prompt 和 MCP，保持 external 所有权。
5. adopt 一个资源后验证 managed 生命周期；detach external 后原文件逐字节不变。
6. Package 提供 Resource，同时直接 external Resource 与其并存并可解释来源。
7. `-Syu --dry-run` 报告全部受影响 Profile；升级失败后版本和运行状态完整回退。
8. 删除包/Profile 时保护仍被引用对象和所有 external 内容。
9. 导出复杂 Profile，在干净状态恢复，验证包哈希、绑定、配置和 DSH 运行清单等价。
10. 使用多软件源、签名、密钥撤销和冲突包验证最终信任策略。
11. 上游 DSH 更新后重放薄 patch 并执行完整兼容性套件。
12. CLI 的文本/JSON 输出、退出码、非交互行为和错误诊断稳定。

### 10.3 远程执行纪律

- 每批测试记录远程主机、Harman commit、DSH commit、工具版本和命令；
- 本地源码通过 SCP/rsync 传入，排除 `.git`、凭据、私钥、GPG keyring、secret 文件和缓存；
- 测试机仓库只用于可丢弃工作副本和日志，不直接形成唯一修复；
- 系统变更前记录 Snapper snapshot number，成功后不自动删除快照；
- 失败时保留诊断状态与日志，不自动 rollback；需要 rollback 时另行确认；
- 远程测试成功不等于发布批准。

### 10.4 证据归档

每个里程碑生成 `evidence/<milestone>/<run-id>/manifest.json`，包含 commit、环境、测试清单、结果、日志哈希、快照、持久变更和重启情况。仓库只提交脱敏、小体积、可复查摘要；大日志保存在测试机或明确的制品存储中并记录校验值。

## 11. 里程碑、依赖与退出门槛

### M0：需求冻结与测试机调研

- 建立需求追踪、远程基线、DSH/生态源码分析、架构 ADR、威胁模型。
- 退出：第 2 节调研门槛全部通过；没有编码。

### M1：Core、状态模型与查询图

- 实现 schema、事务、所有权、引用关系、迁移和 explain/impact 基础。
- 退出：故障注入证明状态原子性，external 保护单元/组件测试通过。

### M2：Repository、Recipe 与 Package Store

- 完成单一可信源、预构建流水线、Store、求解、pacman 风格基础 CLI 和本地 recipe 构建。
- 退出：预构建/本地构建/升级/卸载/回滚端到端通过，普通安装不运行 npm/pnpm 求解。

### M3：Resource Manager

- 完成所有目标类型 scanner、命令、所有权模型、冲突/失效处理。
- 退出：`scan/list/show/register/adopt/enable/disable/bind/detach` 全部远程验收，external 不变证据通过。

### M4：Profile 隔离与 DSH 集成

- 完成 Profile 生命周期、组合、物化、运行、隔离和 explain。
- 退出：多 Profile 并发与社区插件兼容套件通过，DSH Runtime 非目标边界无回归。

### M5：导出、恢复与可复现性

- 完成 lock/export/import/restore/diff/doctor、secret reference、离线恢复和迁移。
- 退出：干净测试环境恢复等价性通过，缺失 external/secret 的失败可诊断且无越权写入。

### M6：多源、签名、校验与信任策略

- 完成提案列为后续的 repo add、多源、签名、密钥生命周期和信任策略。
- 退出：重放、降级、坏签名、撤销、源冲突和优先级测试通过。

### M7：上游同步、性能、安全与发行候选

- 执行 DSH 新版本同步演练、完整安全/性能/兼容/安装升级卸载测试，补齐运维与用户文档。
- 退出：第 13 节完整验收签字；仍不自动发布。

里程碑顺序允许在证据充分时局部并行，但不得跳过退出门槛。每个阶段结束更新需求追踪矩阵和风险登记。

## 12. 工程与版本控制流程

### 12.1 分支与提交

- `main` 始终保持文档/测试状态明确；功能通过短生命周期分支开发。
- 提交按领域和可验证行为拆分，提交信息引用需求编号。
- 不把远程日志、依赖缓存、凭据或构建目录提交到仓库。
- 合并前审查实际 diff、需求链接、远程测试结果和未解决风险。
- 发布、push、tag、GitHub release 必须有独立授权，不因测试通过自动执行。

### 12.2 决策记录

以下主题必须有 ADR：DSH fork 基线、状态数据库、Store 布局、包格式、recipe sandbox、版本求解器、Profile 物化、Resource 身份与所有权、签名/信任根、上游同步策略。

### 12.3 文档交付

- 安装、快速开始和 pacman 风格 CLI 手册；
- recipe 作者、Repository 维护者和 CI 发布手册；
- Resource 类型、扫描范围、adopt 与所有权安全说明；
- Profile 创建、组合、导出、恢复和故障排查；
- DSH 兼容矩阵和插件开发者说明；
- 安全模型、信任策略、密钥轮换和事件恢复；
- 数据格式、迁移、备份/恢复和上游同步维护手册。

## 13. 项目最终验收清单

只有以下条目全部满足，才算“实现 `proposal.md` 中的全部内容”：

- [ ] Package、Resource、Profile 三类对象边界清晰，Package 可提供 Resource，Resource 可独立存在。
- [ ] `-Sy/-Ss/-S/-R/-Syu/-Qi` 及脚本化接口均完成并通过端到端测试。
- [ ] npm/GitHub 等可作上游，npm/pnpm 仅参与构建，普通安装使用固化运行时依赖的预构建包。
- [ ] recipe 获取、解析、构建、收集、打包、CI 测试和发布产物链路可复现。
- [ ] 缺少预构建包时支持受控本地 recipe 构建。
- [ ] Resource Manager 支持提案列出的全部资源类型与全部命令。
- [ ] external/managed 生命周期严格分离，`AGENTS.md` 等项目文件所有权不被改变。
- [ ] Profile 覆盖 Packages、Resources、插件配置、Prompt/Markdown、MCP、模型配置、Cordis Patch 和运行状态。
- [ ] Profile 默认隔离，共享全局 Store 只读且支持版本并存。
- [ ] Profile 可导出、恢复并在干净环境证明结果等价。
- [ ] DSH Runtime、Cordis、插件 ABI、`ctx.*`、Agent Loop、Tool/Skill/MCP Runtime、Session 兼容性达到支持矩阵承诺。
- [ ] 可信 GitHub Repository 的 recipes、index、metadata、CI 和 release artifacts 完整可用。
- [ ] 多软件源、签名、校验和信任策略已实现，不再只是路线图条目。
- [ ] 管理器能回答提案第 9 节列出的来源、引用、版本、存在原因与升级影响问题。
- [ ] 安全、故障注入、性能、安装/升级/卸载、上游同步和负面测试通过。
- [ ] 每个提案需求均有实现、远程测试证据和用户文档的追踪链接。
- [ ] 不存在把 demo、脚手架、单一 happy path 或未验证实现标记为完成的情况。

## 14. 风险与缓解

| 风险 | 缓解措施 |
| --- | --- |
| DSH 上游接口变化快 | 固定基线、薄 adapter、patch queue、上游同步兼容套件 |
| npm 生态依赖/脚本复杂 | recipe 审核、构建隔离、固化依赖、SBOM、负面样本 |
| Profile 隔离不彻底 | 明确所有写路径、并发双 Profile 测试、运行状态 diff |
| external 资源被误删 | 所有权字段、canonical path 防护、manifest 归属校验、逐字节负面测试 |
| 索引/产物供应链攻击 | 哈希、签名、信任根、撤销、重放/降级防护、审计 |
| 导出泄露 secret | 仅导出 secret reference、日志脱敏、恢复时显式注入 |
| fork 长期漂移 | 最小修改、ADR、周期同步演练、可上游化扩展点 |
| 测试机状态污染 | 每项目工作区、系统变更前 Snapper、持久变更清单、禁止无关操作 |

## 15. 开发启动条件

在以下条件全部满足前不得开始业务开发：

1. 本方案已提交到本地 Git 仓库；
2. 用户提供或确认唯一测试机 SSH host/alias；
3. 测试机非交互 SSH、sudo 与 Snapper 能力完成预检；
4. 测试机 `~/test-work/harman` 工作区和临时 Git 仓库已建立；
5. DSH 上游来源、许可、目标基线和支持版本获得确认；
6. M0 调研计划的范围与证据格式已就绪。

满足启动条件只代表允许进入 M0 源码分析，不代表可以跳过调研直接实现。
