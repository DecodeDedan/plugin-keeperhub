<img src="https://raw.githubusercontent.com/DecodeDedan/plugin-keeperhub/main/docs/brand/lockup.png" alt="plugin-keeperhub" width="420" />

Deterministic onchain execution for ElizaOS agents.

## The problem

Agents are probabilistic by design. That is the property that makes them useful, and it is
the property onchain value transfer does not forgive.

An ElizaOS agent that moves funds today builds and signs the transaction inline. The model
decides the recipient, the amount, and the moment, and it decides them *at the moment of
execution*. There is no point at which a human sees what is about to happen while it is still
about to happen. By the time anything is observable, it is on chain and irreversible.

The failure mode is not that the model is bad. It is that the model is asked to be exact,
once, with no second look, on the one operation that cannot be undone. A model that is right
99% of the time is a model that drains a treasury on its hundredth transfer.

The usual mitigations do not close this. A confirmation prompt that asks "are you sure?"
confirms an intent, not a transaction. A spending cap bounds the damage rather than preventing
the mistake. Re-asking the model to restate the plan just asks a probabilistic system to
describe itself, which is not the same as binding it.

## What this brings

KeeperHub becomes the execution layer, and the model is removed from the moment of execution
entirely.

The agent composes an action and KeeperHub dry runs it without touching the chain. The human
reads the exact plan that would execute. On approval, KeeperHub broadcasts **that** plan,
byte for byte. Nothing is inferred at execution time, because by execution time there is
nothing left to infer.

The model contributes exactly once, before anything is reviewable, and what it produced is
shown to a person before it can move value.

## How it works

![The execution path: the model may influence everything before the dry run, and can reach nothing after it](https://raw.githubusercontent.com/DecodeDedan/plugin-keeperhub/main/docs/diagrams/execution-path.png)

<sub>Diagram source: [`docs/diagrams/execution-path.mmd`](https://github.com/DecodeDedan/plugin-keeperhub/blob/main/docs/diagrams/execution-path.mmd). npm renders mermaid
blocks as source rather than as pictures, so the README ships the rendered files; regenerate
them with `node scripts/render-diagrams.mjs`.</sub>

The boundary between the two shaded regions is the whole design, and it is structural rather
than procedural:

- A simulate action has **no code path that broadcasts**. It cannot spend money.
- `KEEPERHUB_CONFIRM` has **no code path that constructs arguments**. It cannot invent a
  transfer. It reads `plan.args` and sends them.

Neither is a rule someone has to remember. Each is the absence of a branch.

## The components

Three kinds of extension, which is what makes this specific to ElizaOS rather than a wrapper
around an HTTP call.

**`KEEPERHUB_WALLET` provider** injects the agent's real wallet, the daily cap that is
actually enforced, and how much of it is left, into context on every composition. The agent
reasons against limits that exist instead of ones it imagined, so a plan that cannot clear
policy is never proposed.

**Three simulate actions** cover transfers, contract calls, and conditional execution. All
three share one dry-run path, so the rule that nothing is queued unless KeeperHub returned an
unambiguous success cannot drift between them.

**`KEEPERHUB_CONFIRM`** replays the reviewed plan. It stores which tool it is replaying, so
one approval path serves every kind of action.

**`KEEPERHUB_STATUS`** reads back whether a broadcast has settled, because `unconfirmed` is a
real outcome and the correct response to it is to poll, never to re-send.

**`KEEPERHUB_RECORD_EXECUTION` evaluator** writes each execution into agent memory.

## The idempotency key

The key is derived from the plan, never generated per attempt. This is worth stating on its
own because getting it wrong is silent and expensive, and the first version of this plugin got
it wrong.

A UUID minted per attempt does not survive a retry: the second attempt sends a different key,
KeeperHub treats the request as new work, and the transfer executes twice. So a task id is
minted once when the dry run queues the plan, and the key is the SHA-256 of a canonical join
of that id with the fields that decide the onchain effect, with chain aliases resolved to
decimal, addresses lowercased, and amounts normalised to a plain decimal string.

Every attempt at one plan sends one key. A fresh dry run is different work and gets a
different one, so two deliberate identical transfers do not collide inside the replay window.

That property is what makes the retry rule safe:

![The retry rule: discard the plan only when the outcome is definite, otherwise keep it so a retry replays under the same key](https://raw.githubusercontent.com/DecodeDedan/plugin-keeperhub/main/docs/diagrams/retry-rule.png)

<sub>Diagram source: [`docs/diagrams/retry-rule.mmd`](https://github.com/DecodeDedan/plugin-keeperhub/blob/main/docs/diagrams/retry-rule.mmd). npm renders mermaid
blocks as source rather than as pictures, so the README ships the rendered files; regenerate
them with `node scripts/render-diagrams.mjs`.</sub>

Rotating the key after a timeout is what turns one intent into two transactions. Keeping a
plan after a definite failure makes a dead key replay that failure for 24 hours. Both
directions are wrong, and which one applies depends only on whether anything is known.

## Install

```bash
npm install plugin-keeperhub
```

```json
{
  "plugins": ["plugin-keeperhub"],
  "settings": {
    "secrets": { "KEEPERHUB_API_KEY": "kh_..." }
  }
}
```

| Setting | Required | Default | Purpose |
|---|---|---|---|
| `KEEPERHUB_API_KEY` | yes | — | Organization API key. Needs `mcp:write` or `mcp:admin` to broadcast; a `mcp:read` key can dry run only. |
| `KEEPERHUB_MCP_URL` | no | `https://app.keeperhub.com/mcp` | MCP endpoint |
| `KEEPERHUB_DEFAULT_CHAIN_ID` | no | `11155111` (Sepolia) | Chain used when the user names none |

The default is a testnet deliberately. Point it at mainnet on purpose, never by forgetting to.

Missing configuration is not fatal: the provider reports that execution is unavailable and
every action refuses, so an agent that also does other things keeps working.

## Behaviour outside the happy path

| Condition | Result |
|---|---|
| KeeperHub unreachable | Provider degrades to a notice; actions refuse. Context composition never throws. |
| Model returns a negative, zero, exponent or numeric amount | Rejected before any call. Nothing queued. |
| Model truncates or mangles an address | Rejected before any call. Nothing queued. |
| Model emits `function_args` as an array rather than the encoded string KeeperHub wants | Normalised once, before the dry run, so the plan stores the wire form and confirm replays it unchanged. |
| Dry run says the call would revert | Nothing queued. Reported as a revert, with the decoded reason. |
| Simulator cannot reach the chain | Nothing queued. Reported as unavailable, explicitly not as a revert, because nothing was learned either way. |
| Dry run fails on balance | Nothing queued. Reports balance, requirement and exact shortfall. |
| KeeperHub answers in an unrecognised shape | Nothing queued. Guards reject rather than cast. |
| View or pure call | Returns its value. Nothing queued, because there is nothing to broadcast. |
| Conditional whose condition does not hold | Reports observed and required values. Nothing queued. |
| Solana chain (101, 103) | Refused before any call. The dry run is EVM-only, and this plugin will not broadcast what it could not preview. |
| User replies ambiguously | `validate` returns false. No broadcast. |
| User approves twice | The plan is consumed on first take. The second finds nothing. |
| Approval arrives 10+ minutes late | Plan expired. The human re-runs the dry run against current state. |
| Broadcast returns `unconfirmed` | Reported as in flight, never as success or failure, because reporting a live transaction as failed is what provokes a double spend. |
| Broadcast times out or returns 5xx | Plan kept. Confirming again derives the same key and replays. |
| `idempotency_in_progress` | Plan kept, same key on retry, nothing sent twice. |
| `idempotency_conflict` | Plan discarded; the original execution id is surfaced. |
| Response carries `idempotentReplay` | Named as a replay, so a stored failure is not mistaken for a fresh one. |
| Key scoped `mcp:read` only | Named as a scope refusal with the scope needed, not a generic failure. |
| Agent restarts mid-approval | Plan lost, which fails toward a repeated dry run rather than a surprise transfer. |

## Development

```bash
pnpm install
pnpm type-check
pnpm test
pnpm build
```

**123 tests across 7 files.** 117 run with no credentials and no network: the MCP client is a
recording double and the model is stubbed, so each test asserts on exactly what would have
reached the chain. Response fixtures in `test/fixtures.ts` are transcribed from KeeperHub
source, and one is a real production response captured verbatim.

The remaining 6 run against a live KeeperHub organization when `KEEPERHUB_API_KEY` is present
and skip otherwise. They verify what no double can: that KeeperHub still answers in the shapes
the guards parse. Every call in that file is a read or a `simulate: true` dry run, so no value
moves; the file contains no broadcast path at all.

The safety properties are mutation tested. Each of these breaks, and each is caught:
re-deriving an argument on the broadcast path, generating the idempotency key per attempt,
rotating the plan away after an ambiguous outcome, reporting an unreachable simulator as a
revert, reporting an unconfirmed broadcast as settled, dropping the Solana guard, weakening
amount canonicalization, leaving the task-id separator unescaped, and weakening a response
guard to accept any shape.

See [DEMO.md](https://github.com/DecodeDedan/plugin-keeperhub/blob/main/DEMO.md) to run it.

## License

MIT
