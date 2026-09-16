# Running the demo

Two ways to show this working. The first proves the mechanism in about a minute and is the
one to run if something breaks live. The second is the real thing: a running ElizaOS agent,
a real model reading a real sentence, and a human approving before anything moves.

Both move real value on a testnet. Neither can move value without an explicit approval step.

## What you need

| Requirement | Why |
|---|---|
| Node 24 | `process.loadEnvFile` and the build target |
| A KeeperHub organization API key (`kh_...`) | Settings, Developer, API keys, Organisation keys. Needs `mcp:write` or `mcp:admin` to broadcast; an `mcp:read` key can dry run only |
| A wallet connected in KeeperHub | Without one every action is refused |
| Testnet funds in that wallet | Ethereum Sepolia by default |

Put the key in `.env` at the project root:

```
KEEPERHUB_API_KEY=kh_your_key
KEEPERHUB_DEFAULT_CHAIN_ID=11155111
```

`.env` is gitignored. Confirm with `git check-ignore .env` before committing anything.

## Demo 1: the mechanism, in one command

```bash
pnpm install
pnpm build
node scripts/proof.mjs
```

This reads the organization's wallet and enforced spending cap, composes a transfer, and dry
runs it through KeeperHub. It prints the exact plan a human would approve, then **stops**.
Nothing is sent.

It also prints the internals that matter:

```
task id       af117dad-7d4a-49de-b336-fae035d7b0a1
derived key   d325397387ae4bf713c9f97ec840769d3cde9dba9426957dae505c381c58d820
stored args   {"chain_id":"11155111","to_address":"0x67f1...","amount":"0.001","simulate":true}
```

Keep that derived key on screen. It is computed from the plan before anything is sent, and
the same value appears again at broadcast. That is the point: the key identifies the work,
not the attempt, so a retry replays instead of sending a second transaction.

To execute the reviewed plan:

```bash
node scripts/proof.mjs --broadcast
```

It confirms, prints the broadcast key alongside the earlier one so you can see they match,
then polls until the chain settles and prints the verified receipt.

Use `--amount=0.0001` for a smaller transfer. The default is a self-transfer, so the value
returns to the same wallet and the only real cost is gas.

**Only the model call is supplied by the script.** Everything downstream -- the dry run, the
plan store, the derived key, the broadcast, the receipt -- is the plugin's real code, the same
code an agent invokes.

## Demo 2: the full agent conversation

This is the one to record. A real model reads your sentence and decides what the transfer is.

### One-time setup

```bash
# Runtime and CLI
curl -fsSL https://bun.sh/install | bash
bun install -g @elizaos/cli

# Local model, so no API key and no data leaves the machine
brew install ollama
ollama serve &
ollama pull qwen2.5:14b
ollama pull nomic-embed-text

# Agent project
elizaos create keeperhub-agent -y -t project
cd keeperhub-agent
bun add file:../plugin-keeperhub
```

Add to the agent's `.env`:

```
KEEPERHUB_API_KEY=kh_your_key
KEEPERHUB_DEFAULT_CHAIN_ID=11155111
OLLAMA_API_ENDPOINT=http://localhost:11434/api
OLLAMA_SMALL_MODEL=qwen2.5:14b
OLLAMA_LARGE_MODEL=qwen2.5:14b
OLLAMA_EMBEDDING_MODEL=nomic-embed-text
```

Load the plugin in `src/character.ts`, inside the `plugins` array:

```ts
...(process.env.KEEPERHUB_API_KEY?.trim() ? ['plugin-keeperhub'] : []),
```

And give the character a system prompt that states the rule, so the model does not try to
narrate a transfer as if it had happened:

```ts
system:
  'You can move value onchain, but never directly. Every request to send, transfer, pay, ' +
  'or call a contract goes through KeeperHub: you compose the action, KeeperHub dry runs it ' +
  'without touching the chain, and the plan is shown to the user. Nothing is broadcast until ' +
  'the user explicitly approves the plan you showed them. Never invent an address or an amount.',
```

### Run it

```bash
bun run build
elizaos start
```

Open `http://localhost:3000` and talk to the agent.

### The script to follow

**1. Ask what it can spend.** The `KEEPERHUB_WALLET` provider puts the real wallet, the
enforced daily cap and the remaining headroom into context, so the answer comes from
KeeperHub rather than from the model's imagination.

> what's my wallet and how much can I spend today?

**2. Ask for a transfer.**

> send 0.001 ETH to 0x67f10576d6333FFA439EB1d4293BB6C9f019F138

The agent replies with the dry-run plan and stops. Nothing has moved. Say so out loud while
recording: this is the step that does not exist in an agent that signs inline.

**3. Try to derail it.** This is the most convincing part of the demo.

> actually make it 10 ETH

The dry run fails on balance and reports the exact shortfall. Nothing is queued, so there is
nothing to approve.

**4. Reply ambiguously.**

> hmm, maybe

`KEEPERHUB_CONFIRM` does not validate, so nothing broadcasts. Approval has to be
unmistakable.

**5. Approve.**

> confirm

The plan is replayed byte for byte and broadcast. The reply carries the execution id, the
transaction hash and the explorer link.

**6. Ask whether it landed.**

> did it land?

`KEEPERHUB_STATUS` reads the receipt back. The receipt is re-fetched from the chain, which is
stronger evidence than the transaction hash the write path reported about itself.

### What a local model does to this demo

`qwen2.5:14b` runs on the machine with no API key. It is materially weaker than a frontier
model at copying a 42-character hex address without altering a digit.

When it does mangle one, the validation in `src/extract.ts` rejects it and the agent asks for
the address again. Nothing is sent. That is the system behaving correctly, and it is worth
keeping in the recording rather than editing out -- an agent signing inline would have
broadcast to the wrong address.

If you want a cleaner run, set `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` in the agent's `.env`
instead. The character file picks the provider up automatically and no plugin code changes.

## Evidence from a real run

Executed against production KeeperHub on Ethereum Sepolia:

```
transaction  0x5b537ffae10324d3b9e620c5b9647f51f24787b23b293d5097b75c5d3d5a048b
execution    qwkk13npsccznblf3m6gr
block        11712998
receipt      success, verified
gas used     74781
```

https://sepolia.etherscan.io/tx/0x5b537ffae10324d3b9e620c5b9647f51f24787b23b293d5097b75c5d3d5a048b

The derived idempotency key printed at plan time was byte-identical to the one sent at
broadcast, which is the property that makes a retry safe.

## Verifying without any of the above

```bash
pnpm test
```

117 tests run with no credentials and no network. With `KEEPERHUB_API_KEY` set, six more run
against the live organization; every call in those is a read or a `simulate: true` dry run,
so no value moves.

## When something goes wrong

| Symptom | Cause |
|---|---|
| Every action refuses, provider says execution unavailable | `KEEPERHUB_API_KEY` is unset or unreadable |
| `403 insufficient_scope` on confirm, nothing sent | Key is `mcp:read`. Broadcasting needs `mcp:write` or `mcp:admin` |
| Dry run reports a shortfall | Wallet is unfunded on that chain. `node scripts/proof.mjs` prints the balance and cap |
| Agent refuses a Solana chain | The dry run is EVM-only, so the plugin declines rather than broadcast something it could not preview |
| Agent replies but never proposes a plan | Model did not produce usable arguments. Repeat the address on its own line |
| `Unable to connect` in the agent log | Ollama is not running. `ollama serve` |
| Confirm says there is no plan waiting | The plan expired after ten minutes, or was already consumed. Ask again for a fresh dry run |
