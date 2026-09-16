# plugin-keeperhub

An ElizaOS plugin that makes KeeperHub the execution layer for onchain value
movement. Built for the KeeperHub x DoraHacks integrations hackathon.

## The invariant

The agent proposes and dry runs. A human approves. KeeperHub broadcasts the
reviewed plan byte for byte.

`src/plan.ts` is where this is enforced. A pending plan stores the exact
argument object that was simulated; `broadcastArgs` may only drop `simulate`
and attach an idempotency key. Nothing else about a payload may change between
dry run and broadcast.

Guard it when changing anything here:

- A simulate action must have no code path that broadcasts.
- `KEEPERHUB_CONFIRM` must have no code path that constructs arguments. It
  replays stored bytes. It must stay agnostic to which tool it is replaying.
- Any new operation goes through `dryRunAndQueue`, so the rule that nothing is
  queued unless the dry run succeeded cannot drift between operations.
- `unconfirmed`, `pending` and `running` are in flight. Never report them as
  success or failure. A caller that reads a live transaction as failed will
  retry, and retrying a fund move is the worst outcome available.
- A revert, a validation failure and an unreachable simulator are three
  different events. Never collapse them: telling someone their call reverts
  when the truth is that nothing was learned is a false claim about the chain.
- The idempotency key comes from `deriveIdempotencyKey(plan.taskId, ...)`.
  Never generate one per attempt. A per-attempt UUID does not survive a retry,
  so the retry is treated as new work and executes a second time. This is the
  single most dangerous line in the codebase to get wrong.
- Keep the plan whenever the outcome is not definite, and only then. Rotating
  the key after a timeout or a 5xx is what turns one intent into two
  transactions; keeping a plan after a definite failure makes a dead key
  replay that failure for 24 hours.

If a change puts the language model back on the broadcast path, it has removed
the reason this plugin exists, however small the diff looks.

## Verifying

```bash
pnpm type-check
pnpm test
pnpm build
```

Tests run with no credentials and no network: the MCP client is faked and the
model is stubbed, so each test asserts on what would have reached the chain.

A test asserting a safety property is worth nothing until it has been seen to
fail. When you touch `broadcastArgs` or either confirm path, break it on
purpose (change an argument on the broadcast side), confirm the determinism
tests fail, then restore.

## External contracts

Both are verified against real sources, not memory. Re-check them rather than
assuming:

- KeeperHub MCP tool schemas: `lib/mcp/tools.ts` in the KeeperHub repo, cloned
  at `../KeeperHub` for reference. `simulate` is a strict boolean; a string is
  rejected rather than coerced.
- Every response shape is transcribed in `src/keeperhub-types.ts`, with the
  KeeperHub source file for each named in the header. Responses are parsed
  through guards, never cast: the values arrive as JSON over MCP, and a cast
  asserts a shape nothing checked. Add a field by reading the source, not by
  adding another `??` fallback to a chain of guesses.
- `test/live.integration.test.ts` checks these shapes against a live
  organization. Run it with `KEEPERHUB_API_KEY` set after changing anything in
  `keeperhub-types.ts`.
- ElizaOS `Plugin`, `Action`, `Provider` types: https://docs.elizaos.ai/plugins/reference
  The package compiles against the real `@elizaos/core`, so type-check catches drift.

## Conventions

- No emojis anywhere.
- Comments explain why a decision was made, not what the line does.
- `../KeeperHub` is a read-only reference. Never write to it.
