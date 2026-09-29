# dsh-plan-compact-execute

为 DSH Web 客户端的 **plan 模式审批卡片**增加第三个选项「压缩后执行」：先把计划提交之前的上下文压缩成一条摘要检查点，再批准计划，模型带着**逐字保留的计划**开始执行。

English | [English](README.en.md)

![计划审批卡片：要求修改、压缩后执行、同意执行](img/example1.png)

## 它做什么

- 审批卡片的操作行从 `[要求修改] [同意执行]` 变成 `[要求修改] [压缩后执行] [同意执行]`；前两者的行为与官方实现完全一致。
- 「压缩后执行」先把该会话中**计划提交之前**的历史压成摘要，再以问题自带的批准标签（`exit_plan_mode` 的 `Approve`）回答挂起的问题，计划模式随即退出。
- 计划正文、审批原文与未完成的工具批次逐字保留；计划之前的探索历史被替换成摘要检查点（对话流里显示为「已压缩」）。
- 压缩进行中三个按钮同时禁用；硬失败（已有压缩在进行、摘要期间表面变化、提交或持久化失败）不会批准计划，卡片内显示宿主诊断，你仍可改点「同意执行」。

## 为什么不是 `/compact`

`/compact` 走 `ctx.compaction.compactNow()`，它抢占 agent 的真正空闲相位；而计划审批发生在 `exit_plan_mode` 工具调用内部，agent 正处于 turn 中，那条路必然失败。

本插件走 `ctx.compaction.compactRegion(...)` —— 与自动压力压缩同一条「turn 内压缩」路径：压缩三元组落在工具调用与其批准回执之间（实测 `call seq=37 < compaction seq=38 < result seq=42`），也就是「先压缩、后批准」。

`/compact` 的保留策略只留最后一条表面事件，用在审批卡片上会把计划本身一起遮蔽进摘要；本插件保留到未完成工具批次为止，计划因此保持逐字可见。

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

## 安装

```bash
dsh plugin --profile web add dsh-plan-compact-execute
```

- **宿主半区是加载的 JS 产物，改动后需要重启网关**；客户端束由 `dsh-client-modules` 监视，改 `lib/client.js` 会热替换。

## License

MIT