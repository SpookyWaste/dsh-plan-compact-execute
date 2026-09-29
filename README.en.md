# dsh-plan-compact-execute

Adds a third option — **Compact and run** — to the DSH Web plan-review card: compact the history submitted before the plan into one summary checkpoint, then approve the plan, so the model starts executing with the **verbatim plan** still in context.

[中文](README.md) | English

![Plan-review card: Request changes, Compact and run, Approve](img/example1.png)

## What it does

- The card's action row changes from `[Request changes] [Approve]` to `[Request changes] [Compact and run] [Approve]`; the two outer decisions behave exactly like the official ones.
- "Compact and run" first condenses the session's history **submitted before the plan** into a summary, then answers the pending review with the question's own approve label (`exit_plan_mode`'s `Approve`), and plan mode exits.
- The plan text, the review transcript, and the unfinished tool batch stay verbatim; earlier exploration is replaced by a summary checkpoint (shown as "已压缩" in the conversation).
- All three buttons are disabled while the compaction runs; a hard failure (an active compaction, a surface change during summarization, a commit or persistence failure) does **not** approve the plan — the card shows the host diagnostic and you can still choose "Approve".

## Why not `/compact`

`/compact` goes through `ctx.compaction.compactNow()`, which claims the agent's true idle phase; a plan review happens inside the `exit_plan_mode` tool call, so the agent is mid-turn and that path necessarily fails.

This plugin uses `ctx.compaction.compactRegion(...)` — the same in-turn path automatic step-pressure compaction uses: the compaction bracket lands between the tool call and its approval result (measured on a real run as `call seq=37 < compaction seq=38 < result seq=42`), which is exactly "compact first, approve second".

`/compact` retention keeps only the last surface node, which on this card would shadow the plan itself into the summary; this plugin retains the tail up to the unfinished tool batch, so the plan stays verbatim.

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `minShadowedTokens` | `2000` | Route-priced tokens the compactable span must hold, otherwise the request proceeds and the host logs why |

```yaml
- id: plan-compact-execute
  name: dsh-plan-compact-execute
  config:
    minShadowedTokens: 4000
```

## Installing

```bash
dsh plugin --profile web add dsh-plan-compact-execute
```

- **The host half is a loaded JS artifact, so restart the gateway after changing it**; the client bundle is watched by `dsh-client-modules`, so editing `lib/client.js` hot-replaces it.

## License

MIT