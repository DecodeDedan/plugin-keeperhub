/**
 * End-to-end proof: compose, dry run, approve, broadcast, verify.
 *
 * Runs the plugin's real action code -- the same simulate action, plan store,
 * confirm action and status action an ElizaOS agent invokes. Only the model
 * call is supplied here rather than by a running agent, so that the proof can
 * be reproduced without standing up a full runtime.
 *
 * Dry run is the default. Broadcasting moves real value and requires an
 * explicit --broadcast flag, because a demo script that spends by default
 * would contradict the property this plugin exists to provide.
 *
 *   node scripts/proof.mjs                 dry run only, nothing is sent
 *   node scripts/proof.mjs --broadcast     dry run, then broadcast and verify
 *
 * Requires `pnpm build` first, and KEEPERHUB_API_KEY in .env.
 */
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(root, ".env");
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const { KeeperHubClient, readConfig } = await import(`${root}/dist/client.js`);
const { createSimulateAction, createConfirmAction, createStatusAction } = await import(
  `${root}/dist/actions.js`
);
const { createPlanStore, createExecutionTracker } = await import(`${root}/dist/plan.js`);
const { parseIntegrations, parseSpendCap } = await import(`${root}/dist/keeperhub-types.js`);
const { deriveIdempotencyKey } = await import(`${root}/dist/idempotency.js`);
const { formatWei, subtractWei } = await import(`${root}/dist/render.js`);

const broadcast = process.argv.includes("--broadcast");
const amount = process.argv.find((a) => a.startsWith("--amount="))?.split("=")[1] ?? "0.001";

const config = readConfig((key) => process.env[key]);
if (!config) {
  console.error("KEEPERHUB_API_KEY is not set. Put it in .env and retry.");
  process.exit(1);
}

const client = new KeeperHubClient(config);
const rule = (label) => console.log(`\n${"=".repeat(64)}\n${label}\n${"=".repeat(64)}`);

rule("ACCOUNT");
const listed = await client.callTool("list_integrations", {});
const wallets = parseIntegrations(listed.ok ? listed.data : undefined).filter(
  (i) => i.type === "web3" && i.address
);
if (wallets.length === 0) {
  console.error("No web3 wallet is connected to this KeeperHub organization.");
  process.exit(1);
}
const wallet = wallets[0];
console.log(`wallet      ${wallet.address}`);
console.log(`chain       ${config.defaultChainId}`);

const cap = parseSpendCap((await client.callTool("get_spending_limits", {})).data);
if (cap) {
  console.log(`daily cap   ${formatWei(cap.effectiveDailyCapWei)} ETH`);
  console.log(`remaining   ${formatWei(subtractWei(cap.effectiveDailyCapWei, cap.dailyUsedWei))} ETH`);
}

const plans = createPlanStore();
const executions = createExecutionTracker();
const deps = {
  getClient: () => client,
  plans,
  executions,
  defaultChainId: () => config.defaultChainId,
};
const room = `proof-${Date.now()}`;
const message = (text) => ({ roomId: room, entityId: "proof", agentId: "proof", content: { text } });
const runtime = {
  useModel: () => Promise.resolve(JSON.stringify({ to_address: wallet.address, amount })),
};
const show = async (content) => {
  console.log(content.text);
  return [];
};

rule("STEP 1  agent proposes, plugin dry runs -- no chain write");
const simulated = await createSimulateAction(deps).handler(
  runtime,
  message(`send ${amount} ETH to ${wallet.address}`),
  undefined,
  undefined,
  show
);
if (!simulated.success) {
  console.error("\nDry run did not pass. Nothing was queued and nothing was sent.");
  process.exit(1);
}

const plan = plans.peek(room);
console.log("\n-- internals --");
console.log(`task id       ${plan.taskId}`);
console.log(`derived key   ${deriveIdempotencyKey(plan.taskId, plan.tool, plan.args)}`);
console.log(`stored args   ${JSON.stringify(plan.args)}`);

if (!broadcast) {
  rule("STOPPED BEFORE BROADCAST");
  console.log("Nothing was sent. Re-run with --broadcast to execute the reviewed plan.");
  await client.close();
  process.exit(0);
}

rule("STEP 2  human approves -- the exact plan is replayed");
const confirmAction = createConfirmAction(deps);
console.log(`validate("confirm") -> ${await confirmAction.validate(runtime, message("confirm"))}`);
const receipt = await confirmAction.handler(
  runtime,
  message("confirm"),
  undefined,
  undefined,
  show
);
console.log("\n-- internals --");
console.log(`broadcast key ${receipt.data?.idempotencyKey}`);
console.log(`same as above ${receipt.data?.idempotencyKey === deriveIdempotencyKey(plan.taskId, plan.tool, plan.args)}`);

rule("STEP 3  poll until the chain settles");
const statusAction = createStatusAction(deps);
for (let attempt = 1; attempt <= 12; attempt++) {
  await new Promise((r) => setTimeout(r, 5000));
  const polled = await statusAction.handler(runtime, message("did it land?"));
  const status = polled.data?.status;
  console.log(`  poll ${attempt}: ${status?.status}${status?.receipts?.length ? ` (${status.receipts.length} receipt)` : ""}`);
  if (status && (status.status === "completed" || status.status === "failed")) {
    rule("FINAL");
    console.log(polled.text);
    break;
  }
}

await client.close();
