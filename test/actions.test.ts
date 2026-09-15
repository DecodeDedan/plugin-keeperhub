import { beforeEach, describe, expect, it, vi } from "vitest";
import { createConfirmAction, createSimulateAction } from "../src/actions.js";
import type { KeeperHubClient } from "../src/client.js";
import { createPlanStore, type PlanStore } from "../src/plan.js";

const ADDR = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const ROOM = "room-1" as never;

type Call = { name: string; args: Record<string, unknown> };

/** Records every MCP call so a test can assert on what would reach the chain. */
function fakeClient(responses: Record<string, unknown>) {
  const calls: Call[] = [];
  const client = {
    callTool: (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args: structuredClone(args) });
      const response = responses[name];
      if (response instanceof Error) {
        return Promise.resolve({ ok: false as const, error: response.message });
      }
      return Promise.resolve({ ok: true as const, data: response, text: "" });
    },
  } as unknown as KeeperHubClient;
  return { client, calls };
}

function message(text: string) {
  return { roomId: ROOM, entityId: "e" as never, content: { text } } as never;
}

/** Runtime stub whose model returns a fixed extraction response. */
function runtimeReturning(raw: string) {
  return { useModel: vi.fn().mockResolvedValue(raw) } as never;
}

const GOOD_EXTRACTION = `{"to_address":"${ADDR}","amount":"0.05"}`;

describe("KEEPERHUB_SIMULATE", () => {
  let plans: PlanStore;

  beforeEach(() => {
    plans = createPlanStore();
  });

  it("dry runs with simulate true and never broadcasts", async () => {
    const { client, calls } = fakeClient({ execute_transfer: { success: true } });
    const action = createSimulateAction({
      getClient: () => client,
      plans,
      defaultChainId: () => "11155111",
    });

    const result = await action.handler(
      runtimeReturning(GOOD_EXTRACTION),
      message(`send 0.05 ETH to ${ADDR}`)
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.args.simulate).toBe(true);
    expect(calls[0]?.args.idempotency_key).toBeUndefined();
    expect((result as { success: boolean }).success).toBe(true);
    expect(plans.peek("room-1")).toBeDefined();
  });

  it("queues nothing when the dry run says the call would revert", async () => {
    const { client } = fakeClient({
      execute_transfer: { success: false, wouldRevert: true },
    });
    const action = createSimulateAction({
      getClient: () => client,
      plans,
      defaultChainId: () => "11155111",
    });

    const result = await action.handler(
      runtimeReturning(GOOD_EXTRACTION),
      message(`send 0.05 ETH to ${ADDR}`)
    );

    expect((result as { success: boolean }).success).toBe(false);
    expect(plans.peek("room-1")).toBeUndefined();
  });

  it("queues nothing when the model produces an unusable amount", async () => {
    const { client, calls } = fakeClient({ execute_transfer: { success: true } });
    const action = createSimulateAction({
      getClient: () => client,
      plans,
      defaultChainId: () => "11155111",
    });

    await action.handler(
      runtimeReturning(`{"to_address":"${ADDR}","amount":"-5"}`),
      message("send some ETH")
    );

    expect(calls).toHaveLength(0);
    expect(plans.peek("room-1")).toBeUndefined();
  });

  it("does not validate when nothing suggests value movement", async () => {
    const { client } = fakeClient({});
    const action = createSimulateAction({
      getClient: () => client,
      plans,
      defaultChainId: () => "11155111",
    });
    await expect(
      action.validate(runtimeReturning(""), message("what is the weather"))
    ).resolves.toBe(false);
  });
});

describe("KEEPERHUB_CONFIRM", () => {
  let plans: PlanStore;

  beforeEach(() => {
    plans = createPlanStore();
  });

  const deps = (client: KeeperHubClient) => ({
    getClient: () => client,
    plans,
    defaultChainId: () => "11155111",
  });

  it("broadcasts arguments identical to the reviewed plan", async () => {
    const { client, calls } = fakeClient({
      execute_transfer: { success: true, transactionHash: "0xdead" },
    });

    const simulate = createSimulateAction(deps(client));
    await simulate.handler(
      runtimeReturning(GOOD_EXTRACTION),
      message(`send 0.05 ETH to ${ADDR}`)
    );

    const confirm = createConfirmAction(deps(client));
    await confirm.handler(runtimeReturning(""), message("confirm"));

    expect(calls).toHaveLength(2);
    const dryRun = calls[0]?.args ?? {};
    const broadcast = calls[1]?.args ?? {};

    // The contract: identical but for simulate leaving and a key arriving.
    const { simulate: _s, ...dryRunRest } = dryRun;
    const { idempotency_key: key, ...broadcastRest } = broadcast;
    expect(broadcastRest).toEqual(dryRunRest);
    expect(typeof key).toBe("string");
    expect(broadcast.simulate).toBeUndefined();
  });

  it("refuses when no plan was reviewed", async () => {
    const { client, calls } = fakeClient({ execute_transfer: { success: true } });
    const confirm = createConfirmAction(deps(client));

    const result = await confirm.handler(runtimeReturning(""), message("confirm"));

    expect(calls).toHaveLength(0);
    expect((result as { success: boolean }).success).toBe(false);
  });

  it("does not validate on an ambiguous reply even with a plan pending", async () => {
    const { client } = fakeClient({ execute_transfer: { success: true } });
    plans.put("room-1", {
      tool: "execute_transfer",
      args: { simulate: true },
      summary: "s",
      createdAt: Date.now(),
    });
    const confirm = createConfirmAction(deps(client));

    await expect(
      confirm.validate(runtimeReturning(""), message("hmm, maybe later"))
    ).resolves.toBe(false);
    await expect(
      confirm.validate(runtimeReturning(""), message("confirm"))
    ).resolves.toBe(true);
  });

  it("consumes the plan so a second approval cannot broadcast twice", async () => {
    const { client, calls } = fakeClient({
      execute_transfer: { success: true, transactionHash: "0xdead" },
    });
    const simulate = createSimulateAction(deps(client));
    await simulate.handler(
      runtimeReturning(GOOD_EXTRACTION),
      message(`send 0.05 ETH to ${ADDR}`)
    );

    const confirm = createConfirmAction(deps(client));
    await confirm.handler(runtimeReturning(""), message("confirm"));
    await confirm.handler(runtimeReturning(""), message("confirm"));

    // One dry run, one broadcast. The repeat found nothing to send.
    expect(calls.filter((c) => c.args.idempotency_key !== undefined)).toHaveLength(1);
  });

  it("reports failure without leaving a replayable plan behind", async () => {
    const { client } = fakeClient({
      execute_transfer: new Error("insufficient funds"),
    });
    plans.put("room-1", {
      tool: "execute_transfer",
      args: { simulate: true, amount: "1" },
      summary: "s",
      createdAt: Date.now(),
    });
    const confirm = createConfirmAction(deps(client));

    const result = await confirm.handler(runtimeReturning(""), message("confirm"));

    expect((result as { success: boolean }).success).toBe(false);
    expect(plans.peek("room-1")).toBeUndefined();
  });
});
