# Infrastructure — Resource Footprint & Deployment (local vs hosted)

_Last updated: 2026-06-09. Measured on the hono fixture (186 source files)._

## Measured footprint

| Component | Peak RAM | CPU / latency | Resident? |
|---|---|---|---|
| Idle MCP server (Bun) | ~31 MB | ~0 | **yes** (only persistent process) |
| codebase-memory index | 5 MB | ~7 ms | no (per-call subprocess) |
| codebase-memory query | 6 MB | ~2 ms | no |
| semble search | 212 MB | ~650 ms wall (~3 s CPU) | no (loads model each call) |
| rtk | ~MB | ~1 ms | no |

Disk (one-time): codebase-memory binary 242 MB, rtk 10 MB, semble model cache 6.5 MB.

**At rest: ~31 MB.** The server shells out to backends **per call**, so backend RAM is transient
(spike then freed), not resident. No memory-holding daemon.

### Scaling notes
- codebase-memory is RAM-first; peak grows with repo size (5 MB for hono; ~5 GB for the 28M-LOC
  Linux kernel per its docs). Typical project repos index in tens of MB. It self-sets a RAM
  budget (~half system RAM).
- The one real cost is **semble reloading its model every call** (212 MB / ~0.65 s). For heavy
  semantic use, run semble as a persistent daemon (≈212 MB resident, no reload). Structural
  (codebase-memory) has no reload cost — a reason it's the primary backend.

## Deployment decision: **local-first** (stdio MCP)

We build a **local stdio MCP server** spawned by the IDE per workspace (matches SPEC). This is a
deliberate choice, not a default:

| Axis | Local (chosen) | Hosted/remote MCP |
|---|---|---|
| Code privacy | code never leaves the machine | ships codebase to a server |
| Enterprise adoption | no security/IP-egress review gate | egress review — likely a blocker |
| Retrieval latency | local, sub-ms | network round-trip per query |
| Infra/ops/cost | none | hosting + auth + maintenance |
| Offline / no keys | yes | no |
| Shared team index | each dev indexes their checkout | index once centrally |

**Rationale:** the value is cutting *tokens sent to the LLM* — achieved regardless of where the MCP
runs — so hosting only adds downsides. "100% local, your code never leaves your machine" is also a
pitch asset (sidesteps the enterprise security review that would kill a hosted tool) and fits the
project's IP caution. The cache-aware egress/routing layer is likewise best as a local proxy (the
9router model).

**Future option:** add a hosted mode via MCP Streamable-HTTP transport *only* for teams that
explicitly want a shared central index. Not a priority.
