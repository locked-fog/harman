# Profiles and DSH Runtimes

## 日常路径

普通使用不需要先理解 Profile 和 Runtime 的内部对象。初始化会创建名为
`default` 的 Profile，并尝试发现全局 npm 安装的 `@deepseek-ai/dsh`：

```text
harman init
harman -Sy
harman -S dsh-better-sidebar
harman run
```

`-S`、`-R` 和 `run` 默认作用于当前命令目标：优先使用
`profile use NAME` 选中的 Profile，其次使用 `default`。也可以显式指定
`--profile NAME`：

```text
harman profile use work
harman --profile work -S dsh-better-sidebar
harman --profile work -R dsh-better-sidebar
harman --profile work run --dump-config
```

如果 DSH 尚未安装，初始化仍会成功；安装后执行：

```text
harman runtime detect
```

它会自动读取全局 npm 包的版本、可执行入口和 SHA-256。手动
`runtime register VERSION EXECUTABLE SHA256 SOURCE` 只作为高级或非 npm
安装场景的后备路径。

## Runtime 选择

Profile 默认保存 `{channel:"latest"}`，而不是某个固定版本。Harman 会
记录兼容性合同的结果，但不会因为候选版本标记为 `breaking` 或
`unvalidated` 就阻止 `latest` 前进或阻止启动。这样可以跟随官方 DSH
上游；如果某次升级确实无法工作，再把受影响的 Profile 固定到已知可用
版本：

```text
harman runtime list
harman profile runtime default 0.1.0-rc.7
harman profile runtime default latest
harman runtime sync
```

精确版本是用户主动选择的降级/复现手段。每次运行仍记录实际解析出的
版本、来源、哈希和时间；这不会把 `latest` 策略永久改成固定版本。

## Named Profile 和高级操作

需要多个隔离环境时，可以创建命名 Profile：

```text
harman profile create work
harman profile create web --app web
harman profile list
harman profile show work
harman profile clone work experiment
harman profile diff work experiment
harman profile doctor work
harman profile export work ./work.bundle
harman profile restore ./work.bundle restored --mode strict
harman profile restore ./work.bundle current --mode follow-latest
harman --dry-run profile delete experiment
harman --yes profile delete experiment
```

对于包、资源、插件配置、Prompt、MCP、模型配置和 Cordis Patch，可在
创建时通过 `--config FILE` 提供声明。秘密字段必须使用
`{"secretRef":"env:MODEL_KEY"}` 一类引用。

每个 Profile 拥有独立的 `DSH_HOME`。共享 Store 与其他 Profile 在运行时
只读；当前 Profile 才能写入设置、凭据、Session、Storage、Preset 和
缓存。`doctor` 报告 Profile 声明、Runtime 状态、最近一次解析结果、
manifest、lock 和 Store 链接。

导出包携带已验证的 Package 内容与受管理 Resource 的副本；外部文件不会
被擅自复制或删除。`strict` 重放导出时的实际 Runtime，
`follow-latest` 保留通道策略并解析当前的 latest；两者都会报告语义锁
等价性，并拒绝被修改的 manifest 或对象。
