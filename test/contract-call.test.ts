import { beforeEach, describe, expect, it, vi } from "vitest";
import { createConfirmAction, createContractCallAction } from "../src/actions.js";
import type { KeeperHubClient } from "../src/client.js";
import { parseContractCallIntent } from "../src/extract.js";
import { createPlanStore, type PlanStore } from "../src/plan.js";

const CONTRACT = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const SPENDER = "0xAbC7B196Cb0C7B01d743Fbc6116a902379C72381";
const ROOM = "room-1" as never;

type Call = { name: string; args: Record<string, unknown> };

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

const message = (text: string) =>
  ({ roomId: ROOM, entityId: "e" as never, content: { text } }) as never;

const runtimeReturning = (raw: string) =>
  ({ useModel: vi.fn().mockResolvedValue(raw) }) as never;

describe("parseContractCallIntent", () => {
  it("encodes an array of args as the JSON string KeeperHub expects", () => {
    const result = parseContractCallIntent(
      `{"contract_address":"${CONTRACT}","function_name":"approve","function_args":["${SPENDER}","1000"]}`
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.intent.function_args).toBe(`["${SPENDER}","1000"]`);
    }
  });

  it("passes through args already encoded as a string", () => {
    const result = parseContractCallIntent(
      `{"contract_address":"${CONTRACT}","function_name":"approve","function_args":"[\\"1000\\"]"}`
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.intent.function_args).toBe('["1000"]');
    }
  });

  it.each([
    ["a non-array args value", `{"contract_address":"${CONTRACT}","function_name":"f","function_args":"not-an-array"}`],
    ["a function name that is not an identifier", `{"contract_address":"${CONTRACT}","function_name":"transfer(); drop"}`],
    ["a malformed contract address", '{"contract_address":"0x123","function_name":"f"}'],
    ["a missing function name", `{"contract_address":"${CONTRACT}"}`],
    ["a negative payable value", `{"contract_address":"${CONTRACT}","function_name":"f","value":"-1"}`],
  ])("rejects %s", (_label, raw) => {
    expect(parseContractCallIntent(raw).ok).toBe(false);
  });

  it("treats null as no intent", () => {
    expect(parseContractCallIntent("null").ok).toBe(false);
  });
});

describe("KEEPERHUB_SIMULATE_CALL", () => {
  let plans: PlanStore;
  beforeEach(() => {
    plans = createPlanStore();
  });

  const deps = (client: KeeperHubClient) => ({
    getClient: () => client,
    plans,
    defaultChainId: () => "11155111",
  });

  const EXTRACTION = `{"contract_address":"${CONTRACT}","function_name":"approve","function_args":["${SPENDER}","1000"]}`;

  it("dry runs with simulate true and never broadcasts", async () => {
    const { client, calls } = fakeClient({ execute_contract_call: { success: true } });
    const action = createContractCallAction(deps(client));

    await action.handler(runtimeReturning(EXTRACTION), message("call approve on the token"));

    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe("execute_contract_call");
    expect(calls[0]?.args.simulate).toBe(true);
    expect(calls[0]?.args.idempotency_key).toBeUndefined();
    expect(plans.peek("room-1")).toBeDefined();
  });

  it("replays the identical payload on confirm, through the same spine as transfers", async () => {
    const { client, calls } = fakeClient({
      execute_contract_call: { success: true, transactionHash: "0xbeef" },
    });

    await createContractCallAction(deps(client)).handler(
      runtimeReturning(EXTRACTION),
      message("call approve on the token")
    );
    await createConfirmAction(deps(client)).handler(runtimeReturning(""), message("confirm"));

    expect(calls).toHaveLength(2);
    expect(calls[1]?.name).toBe("execute_contract_call");

    const { simulate: _s, ...dryRun } = calls[0]?.args ?? {};
    const { idempotency_key: key, ...broadcast } = calls[1]?.args ?? {};
    expect(broadcast).toEqual(dryRun);
    expect(typeof key).toBe("string");
  });

  it("queues nothing when the dry run would revert", async () => {
    const { client } = fakeClient({
      execute_contract_call: { success: false, wouldRevert: true },
    });
    const action = createContractCallAction(deps(client));

    const result = await action.handler(
      runtimeReturning(EXTRACTION),
      message("call approve on the token")
    );

    expect((result as { success: boolean }).success).toBe(false);
    expect(plans.peek("room-1")).toBeUndefined();
  });

  it("queues nothing when the model invents a malformed contract", async () => {
    const { client, calls } = fakeClient({ execute_contract_call: { success: true } });
    const action = createContractCallAction(deps(client));

    await action.handler(
      runtimeReturning('{"contract_address":"0xnope","function_name":"approve"}'),
      message("call approve")
    );

    expect(calls).toHaveLength(0);
    expect(plans.peek("room-1")).toBeUndefined();
  });
});
