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
payable ones. It shares the dry-run spine with transfers, so the rule that nothing reaches the
plan store unless KeeperHub said it would succeed cannot drift between the two.

**`KEEPERHUB_CONFIRM` action** validates only when a plan is pending for that room and the
human wrote something unmistakably affirmative. It replays the stored argument payload
verbatim, dropping `simulate` and attaching a fresh idempotency key. It has no code path that
constructs arguments. It structurally cannot invent a transfer.

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
| Dry run says the call would revert | Nothing queued, so there is nothing to confirm. |
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

The suite runs without credentials or network: the MCP client is faked and the model is stubbed,
so every test asserts on what would have reached the chain.

## License

MIT
