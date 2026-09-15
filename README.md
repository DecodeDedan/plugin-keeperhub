# plugin-keeperhub

Deterministic onchain execution for ElizaOS agents.

An Eliza agent that moves funds today builds and signs a transaction inline, which means a
language model decides what happens at the exact moment it matters most. This plugin removes
that. The agent composes and dry runs a plan through KeeperHub, a human reviews it, and then
that plan executes byte for byte. Nothing is inferred at execution time.

## How it works

Three components, and the split between the two actions is the whole design.

**`KEEPERHUB_WALLET` provider** injects the agent's real wallet, its enforced daily spending
caps and usage so far into context on every composition. The agent reasons against limits that
actually exist instead of ones it imagined.

**`KEEPERHUB_SIMULATE` action** fires on any request to move value. It extracts the intent,
validates the shape, calls KeeperHub with `simulate: true`, and posts the resulting plan back
into the room. It has no code path that broadcasts. It structurally cannot spend money.

**`KEEPERHUB_SIMULATE_CALL` action** does the same for smart contract function calls, including
payable ones.

**`KEEPERHUB_SIMULATE_CONDITIONAL` action** does the same for conditional execution: read one
scalar from a contract, and call a function only if a comparison holds.

All three share one dry-run path, so the rule that nothing reaches the plan store unless
KeeperHub returned an unambiguous success cannot drift between them.

**`KEEPERHUB_STATUS` action** reads back whether a broadcast execution has settled. It exists
because `unconfirmed` is a real outcome and the correct response to it is to poll, never to
re-send.

**`KEEPERHUB_CONFIRM` action** validates only when a plan is pending for that room and the
human wrote something unmistakably affirmative. It replays the stored argument payload
verbatim, dropping `simulate` and attaching the plan's idempotency key. It has no code path
that constructs arguments. It structurally cannot invent a transfer.

The key is **derived from the plan, never generated per attempt**. KeeperHub documents why:
a per-attempt UUID does not survive a retry, so the second attempt is treated as new work and
executes again. A task id is minted once when the dry run queues the plan, and the key is the
SHA-256 of a canonical join of that id with the fields that decide the onchain effect, with
chain aliases resolved, addresses lowercased and amounts normalised to a decimal string. Every
attempt at one plan sends one key; a fresh dry run is different work and gets a different one.

**`KEEPERHUB_RECORD_EXECUTION` evaluator** writes each execution into agent memory, so the
agent can answer what it did without the human re-reading scrollback.

```
user asks -> SIMULATE / SIMULATE_CALL (dry run, no chain)
          -> human reads plan
          -> "confirm"
          -> CONFIRM (exact replay)
```

Confirm stores which tool it is replaying, so it is agnostic to what was queued. A transfer and
a contract call share one approval path.

The model contributes to the payload exactly once, during simulate, and everything it produced
is shown to a human before it can move value. On approval the stored bytes are replayed. A
design that re-derives arguments at confirm time would put the model back in the loop at the
one moment the human already signed off on something specific.

## Install

```bash
npm install plugin-keeperhub
```

Add to your character file:

```json
{
  "plugins": ["plugin-keeperhub"],
  "settings": {
    "secrets": {
      "KEEPERHUB_API_KEY": "kh_..."
    }
  }
}
```

| Setting | Required | Default | Purpose |
|---|---|---|---|
| `KEEPERHUB_API_KEY` | yes | — | Organization API key from KeeperHub settings |
| `KEEPERHUB_MCP_URL` | no | `https://app.keeperhub.com/mcp` | MCP endpoint |
| `KEEPERHUB_DEFAULT_CHAIN_ID` | no | `11155111` (Sepolia) | Chain used when the user names none |

The default is a testnet on purpose. Point it at mainnet deliberately, never by forgetting to.

Missing configuration is not fatal: the provider reports that execution is unavailable and both
actions refuse, so an agent that also does other things keeps working.

## Behaviour outside the happy path

| Condition | Result |
|---|---|
| KeeperHub unreachable | Provider degrades to a notice; actions refuse. Context composition never throws. |
| Model returns a negative, zero, exponent or numeric amount | Rejected before any call. Nothing queued. |
| Model emits `function_args` as an array rather than the encoded string KeeperHub wants | Normalised once, before the dry run, so the plan stores the wire form and confirm replays it unchanged. |
| Model invents a function name that is not a Solidity identifier | Rejected before any call. Nothing queued. |
| Model truncates or mangles an address | Rejected before any call. Nothing queued. |
| Dry run says the call would revert | Nothing queued. Reported as a revert, with the decoded reason. |
| Simulator cannot reach the chain | Nothing queued. Reported as unavailable, explicitly not as a revert, because nothing was learned either way. |
| Dry run fails on balance | Nothing queued. Reports balance, requirement and exact shortfall. |
| KeeperHub answers in an unrecognised shape | Nothing queued. Guards reject rather than cast. |
| Broadcast returns `unconfirmed` | Reported as in flight, never as success or failure. The agent is told to poll, not re-send, because reporting a live transaction as failed is what provokes a double spend. |
| Broadcast times out or returns 5xx | No definite outcome, so the plan is kept. Confirming again derives the same key and replays rather than sending a second transaction. Rotating the key here is what turns one intent into two transfers. |
| `idempotency_in_progress` | The first attempt is still running. Plan kept, same key on retry, nothing sent twice. |
| `idempotency_conflict` | Definite; retrying cannot help. Plan discarded, and the original execution id is surfaced. |
| Response carries `idempotentReplay` | Named as a replay, so a stored failure is not mistaken for a fresh one. |
| Key scoped `mcp:read` only | Named as a scope refusal with the scope needed, not a generic failure. |
| View or pure call | Returns its value. Nothing queued, because there is nothing to broadcast. |
| Conditional whose condition does not hold | Reports the observed and required values. Nothing queued. |
| Solana chain (101, 103) | Refused before any call. Dry run is EVM-only, and this plugin will not broadcast what it could not preview. |
| User replies ambiguously | `validate` returns false. No broadcast. |
| User approves twice | The plan is consumed on first take. The second finds nothing. |
| Approval arrives 10+ minutes late | Plan expired. The human re-runs the dry run against current state. |
| Broadcast fails | Reported, plan discarded, nothing left replayable. |
| Agent restarts mid-approval | Plan lost, which fails toward a repeated dry run rather than a surprise transfer. |

## Development

```bash
pnpm install
pnpm type-check
pnpm test
pnpm build
```

Seventy tests run with no credentials and no network: the MCP client is a recording double and
the model is stubbed, so each test asserts on exactly what would have reached the chain.
Response fixtures in `test/fixtures.ts` are transcribed from KeeperHub source, not from a
response seen once.

Four further tests run against a real KeeperHub organization when credentials are present, and
skip otherwise:

```bash
KEEPERHUB_API_KEY=kh_... pnpm test
```

They verify the live contract that no double can: that KeeperHub still answers in the shapes
the guards parse. Every call in that file is a read or a `simulate: true` dry run, so no value
moves; the file contains no broadcast path at all.

The safety properties are mutation tested. Each of these breaks, and each is caught:
re-deriving an argument on the broadcast path, generating the idempotency key per attempt
instead of per plan, rotating the plan away after an ambiguous outcome, reporting an
unreachable simulator as a revert, reporting an unconfirmed broadcast as settled, dropping the
Solana guard, weakening amount canonicalization, leaving the task-id separator unescaped, and
weakening a response guard to accept any shape.

## License

MIT
