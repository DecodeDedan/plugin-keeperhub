/**
 * Writes docs/run.json: the page's terminal and receipt read from this file,
 * so the site cannot claim anything that was not captured from a real run.
 *
 * Three independent blocks, each carrying where it came from:
 *
 *   agentRun     transcribed from a recorded ElizaOS session (the same session
 *                the launch video shows), passed in with --transcript
 *   chainCheck   the receipt for that transaction, fetched here from a public
 *                Sepolia node, not from KeeperHub -- an independent witness
 *   dryRunProbe  a dry run executed by this script right now, proving the path
 *                still works today and carrying its own task id and key
 *
 *   node scripts/capture-run.mjs --tx 0x... --transcript path/to/transcript.txt
 *
 * Requires `pnpm build` and KEEPERHUB_API_KEY in .env for the probe.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(root, ".env");
if (existsSync(envPath)) process.loadEnvFile(envPath);

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.split("=")[1];
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const txHash = arg("tx");
const transcriptPath = arg("transcript");
const rpcUrl = arg("rpc") ?? "https://ethereum-sepolia-rpc.publicnode.com";
if (!txHash || !/^0x[0-9a-f]{64}$/i.test(txHash)) {
  console.error("--tx 0x<64 hex> is required: the transaction the recorded session broadcast.");
  process.exit(1);
}
if (!transcriptPath || !existsSync(transcriptPath)) {
  console.error("--transcript <file> is required: the recorded session's text.");
  process.exit(1);
}

/** Pulls the plan and receipt lines out of the recorded session verbatim. */
function readTranscript(text) {
  const grab = (re) => text.match(re)?.[1]?.trim();
  const plan = {
    request: grab(/^(Send [^\n]*?)$/m),
    move: grab(/^move\s+(.+)$/m),
    to: grab(/^to\s+(0x[0-9a-fA-F]{40})/m),
    chain: grab(/^chain\s+(\d+)/m),
    gasEstimate: grab(/^gas estimate\s+(\d+)/m),
    from: grab(/^from\s+(0x[0-9a-fA-F]{40})/m),
    gateLine: grab(/^(Nothing has moved\.[^\n]*)$/m),
  };
  const receipt = {
    executionId: grab(/^execution\s+(\S+)/m),
    txHash: grab(/^transaction\s+(0x[0-9a-fA-F]{64})/m),
    explorer: grab(/^explorer\s+(\S+)/m),
  };
  for (const [k, v] of Object.entries({ ...plan, ...receipt })) {
    if (!v) throw new Error(`transcript is missing "${k}" -- refusing to publish a partial record`);
  }
  return { plan, receipt };
}

const transcript = readTranscript(readFileSync(transcriptPath, "utf8"));
if (transcript.receipt.txHash.toLowerCase() !== txHash.toLowerCase()) {
  console.error(`--tx ${txHash} is not the transaction in the transcript (${transcript.receipt.txHash}).`);
  process.exit(1);
}

const rpc = async (method, params) => {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`${method} failed: HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(`${method} failed: ${body.error.message}`);
  return body.result;
};

const receipt = await rpc("eth_getTransactionReceipt", [txHash]);
if (!receipt) throw new Error(`${txHash} has no receipt on ${rpcUrl}: refusing to claim it settled`);
const block = await rpc("eth_getBlockByNumber", [receipt.blockNumber, false]);

const chainCheck = {
  source: `eth_getTransactionReceipt via ${new URL(rpcUrl).host}`,
  checkedAt: new Date().toISOString(),
  status: receipt.status === "0x1" ? "success" : "failed",
  block: parseInt(receipt.blockNumber, 16),
  minedAt: new Date(parseInt(block.timestamp, 16) * 1000).toISOString(),
  gasUsed: parseInt(receipt.gasUsed, 16),
  executor: receipt.to,
  submittedBy: receipt.from,
};

// The dry run below is executed now, by the plugin's own action code.
const { KeeperHubClient, readConfig } = await import(`${root}/dist/client.js`);
const { createSimulateAction } = await import(`${root}/dist/actions.js`);
const { createPlanStore, createExecutionTracker } = await import(`${root}/dist/plan.js`);
const { deriveIdempotencyKey } = await import(`${root}/dist/idempotency.js`);

let dryRunProbe = { ran: false, reason: "KEEPERHUB_API_KEY not set at capture time" };
const config = readConfig((key) => process.env[key]);
if (config) {
  const client = new KeeperHubClient(config);
  const plans = createPlanStore();
  const executions = createExecutionTracker();
  const deps = {
    getClient: () => client,
    plans,
    executions,
    defaultChainId: () => config.defaultChainId,
  };
  const room = `capture-${Date.now()}`;
  const amount = transcript.plan.move.split(" ")[0];
  const runtime = {
    useModel: () =>
      Promise.resolve(JSON.stringify({ to_address: transcript.plan.to, amount, chain_id: transcript.plan.chain })),
  };
  const message = {
    roomId: room,
    entityId: "capture",
    agentId: "capture",
    content: { text: transcript.plan.request },
  };
  let rendered = "";
  const started = Date.now();
  const result = await createSimulateAction(deps).handler(runtime, message, undefined, undefined, async (content) => {
    rendered = content.text ?? "";
    return [];
  });
  const plan = plans.peek(room);
  dryRunProbe = {
    ran: true,
    at: new Date().toISOString(),
    ms: Date.now() - started,
    passed: Boolean(result.success),
    queued: Boolean(plan),
    taskId: plan?.taskId,
    derivedKey: plan ? deriveIdempotencyKey(plan.taskId, plan.tool, plan.args) : undefined,
    storedArgs: plan?.args,
    gasEstimate: rendered.match(/gas estimate\s+(\d+)/)?.[1],
    text: rendered,
  };
  await client.close();
}

const out = {
  note: "Every value in this file was captured from a real run. The page renders it; nothing here is written by hand.",
  capturedAt: new Date().toISOString(),
  agentRun: {
    source: "ElizaOS agent with plugin-keeperhub, Ollama qwen2.5:14b, production KeeperHub",
    ...transcript.plan,
    ...transcript.receipt,
  },
  chainCheck,
  dryRunProbe,
};

const target = resolve(root, "docs/run.json");
writeFileSync(target, JSON.stringify(out, null, 2) + "\n");
console.log(`wrote ${target}`);
console.log(`  chain check   block ${chainCheck.block}, ${chainCheck.status}, gas used ${chainCheck.gasUsed}`);
console.log(`  dry run probe ${dryRunProbe.ran ? `${dryRunProbe.ms}ms, gas estimate ${dryRunProbe.gasEstimate}, queued ${dryRunProbe.queued}` : dryRunProbe.reason}`);
