# dsh-plan-compact-execute

为 DSH Web 客户端的 **plan 模式审批卡片**增加第三个选项「压缩后执行」：先把计划提交之前的上下文压缩成一条摘要检查点，再批准计划，模型带着**逐字保留的计划**开始执行。

[![Listed on dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/zh/plugins/spookywaste/dsh-plan-compact-execute)
[![DSH](https://img.shields.io/badge/DSH-0.1.7--rc.2%20--%200.2.0--rc.2-blue)](https://github.com/deepseek-ai/deepseek-harness)

中文 | [English](README.en.md)

## 它做什么

<p align="center">
  <img src="img/example2.png" width="500" title="计划审批卡片：标题行里的「压缩后执行」与官方「查看全文」，底部仍是官方两个决策" >
</p>

- 在审批卡片的标题行增加一个「压缩后执行」按钮。
- 按钮左侧的圆环显示当前上下文占用（悬停显示具体数值）。
- 点它以后先把该会话中**计划提交之前**的历史压成摘要，再以问题自带的批准标签（`exit_plan_mode` 的 `Approve`）回答挂起的问题，计划模式随即退出。
- 计划正文、审批原文与未完成的工具批次逐字保留；计划之前的探索历史被替换成摘要检查点（对话流里显示为「已压缩」）。
- 压缩期间整张审阅卡会被一张进度卡替换，避免第二次决策在宿主改写历史的中途落地。

## 安装
### CLI安装
```bash
dsh plugin --profile web add dsh-plan-compact-execute
```
### 网页版/桌面版插件管理安装
官方插件面板->右上角 +添加插件->填入插件名（dsh-plan-compact-execute）或仓库地址
```bash
https://github.com/SpookyWaste/dsh-plan-compact-execute
```

| 要求 | 值 |
|---|---|
| Node | 24（测试套件下限 22.15） |
| DSH | `0.1.7-rc.2` / `0.2.0-rc.2` |

- **宿主半区是加载的 JS 产物，改动后需要重启网关**
- 客户端束由 `dsh-client-modules` 监视，会热替换

## 为什么不是 `/compact`

`/compact` 走 `ctx.compaction.compactNow()`，它抢占 agent 的真正空闲相位；而计划审批发生在 `exit_plan_mode` 工具调用内部，agent 正处于 turn 中，那条路必然失败。

本插件走 `ctx.compaction.compactRegion(...)` —— 与自动压力压缩同一条「turn 内压缩」路径：压缩三元组落在工具调用与其批准回执之间（实测 `call seq=37 < compaction seq=38 < result seq=42`），也就是「先压缩、后批准」。

`/compact` 的保留策略只留最后一条表面事件，用在审批卡片上会把计划本身一起遮蔽进摘要；本插件保留到未完成工具批次为止，计划因此保持逐字可见。

## 计划不会被压缩

「压缩后执行」的跨度是**待审工具批次之前**的全部历史，所以计划正文、审批原文与那条未回答的 `exit_plan_mode` 调用始终在跨度之外：压缩只会把更早的探索历史（以及更早的检查点本身）换成摘要。

## 配置

| 字段 | 默认 | 含义 |
|---|---|---|
| `minShadowedTokens` | `2000` | 可压缩区间按路由计价至少要有这么多 token，否则直接批准（宿主记一条日志） |

```yaml
- id: plan-compact-execute
  name: dsh-plan-compact-execute
  config:
    minShadowedTokens: 4000
```

## License

MIT
