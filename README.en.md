# dsh-plan-compact-execute

Adds a third option — **Compact and run** — to the DSH Web plan-review card: compact the history submitted before the plan into one summary checkpoint, then approve the plan, so the model starts executing with the **verbatim plan** still in context.

[![Listed on dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/en/plugins/spookywaste/dsh-plan-compact-execute)
[![DSH](https://img.shields.io/badge/DSH-0.1.7--rc.2%20--%200.2.0--rc.2-blue)](https://github.com/deepseek-ai/deepseek-harness)

English | [中文](README.md)

## What it does

<p align="center">
  <img src="img/example2.png" width="500" title="Plan-review card: Compact and run beside the official full-plan link, Request changes and Approve in the footer" >
</p>

- A "Compact and run" button joins the card's title row.
- The ring at the left of that button shows the current context occupancy (hover it for the exact figure).
- The button first condenses the session's history **submitted before the plan** into a summary, then answers the pending review with the question's own approve label (`exit_plan_mode`'s `Approve`), and plan mode exits.
- The plan text, the review transcript, and the unfinished tool batch stay verbatim; earlier exploration is replaced by a summary checkpoint (shown as "已压缩" in the conversation).
- While the compaction runs the whole review card is replaced by a progress card, so a second decision can never land while the host is rewriting the history.

## Installing

### CLI

```bash
dsh plugin --profile web add dsh-plan-compact-execute
```

### Web / desktop plugin manager

The official plugin panel's add action, in its top-right corner → enter the plugin name (`dsh-plan-compact-execute`) or the repository URL:

```bash
https://github.com/SpookyWaste/dsh-plan-compact-execute
```

| Requirement | Value |
|---|---|
| Node | 24 (the test suite needs 22.15) |
| DSH | `0.1.7-rc.2` / `0.2.0-rc.2` |

- **The host half is a loaded JS artifact, so restart the gateway after changing it**
- The client bundle is watched by `dsh-client-modules` and hot-replaces

## Why not `/compact`

`/compact` goes through `ctx.compaction.compactNow()`, which claims the agent's true idle phase; a plan review happens inside the `exit_plan_mode` tool call, so the agent is mid-turn and that path necessarily fails.

This plugin uses `ctx.compaction.compactRegion(...)` — the same in-turn path automatic step-pressure compaction uses: the compaction bracket lands between the tool call and its approval result (measured on a real run as `call seq=37 < compaction seq=38 < result seq=42`), which is exactly "compact first, approve second".

`/compact` retention keeps only the last surface node, which on this card would shadow the plan itself into the summary; this plugin retains the tail up to the unfinished tool batch, so the plan stays verbatim.

## The plan is never compacted

"Compact and run" spans everything **before** the pending tool batch, so the plan text, the review transcript, and the unanswered `exit_plan_mode` call always fall outside it: only older exploration — and older checkpoints themselves — get replaced by the summary.

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

## License

MIT
