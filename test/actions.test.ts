import { describe, expect, it } from "vitest";
import {
  createCheckAndExecuteAction,
  createConfirmAction,
  createContractCallAction,
  createSimulateAction,
  createStatusAction,
} from "../src/actions.js";
import {
  conditionNotMet,
  CONTRACT,
  deps,
  errorConflict,
  errorInProgress,
  errorInsufficientScope,
  executeCompleted,
  liveInsufficientBalanceError,
  executeReplayed,
  executeFailed,
  executeUnconfirmed,
  executionStatusCompleted,
  executionStatusWithReceipts,
  message,
  readResult,
  RECIPIENT,
  recordingClient,
  runtimeReturning,
  simulateInsufficientBalance,
  simulateRevert,
  simulateSuccess,
  simulateUnavailable,
} from "./fixtures.js";

const TRANSFER_EXTRACTION = `{"to_address":"${RECIPIENT}","amount":"0.05"}`;
const CALL_EXTRACTION = `{"contract_address":"${CONTRACT}","function_name":"approve","function_args":["${RECIPIENT}","1000"]}`;
const CONDITIONAL_EXTRACTION = `{"contract_address":"${CONTRACT}","function_name":"balanceOf","function_args":["${RECIPIENT}"],"condition":{"operator":"gt","value":"1000"},"action":{"contract_address":"${CONTRACT}","function_name":"transfer","function_args":["${RECIPIENT}","1000"]}}`;

describe("dry run never broadcasts", () => {
  it.each([
    ["transfer", createSimulateAction, "execute_transfer", TRANSFER_EXTRACTION, "send 0.05 ETH"],
    ["contract call", createContractCallAction, "execute_contract_call", CALL_EXTRACTION, "call approve"],
    [
      "conditional",
      createCheckAndExecuteAction,
      "execute_check_and_execute",
      CONDITIONAL_EXTRACTION,
      "if the balance is above 1000 then transfer",
    ],
  ])("%s dry runs with simulate true and no idempotency key", async (
    _label,
    factory,
    tool,
    extraction,
    text
  ) => {
    const { client, calls } = recordingClient({ [tool]: simulateSuccess });
    const d = deps(client);

    const result = await factory(d).handler(runtimeReturning(extraction), message(text));

    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe(tool);
    expect(calls[0]?.args.simulate).toBe(true);
    expect(calls[0]?.args.idempotency_key).toBeUndefined();
    expect((result as { success: boolean }).success).toBe(true);
    expect(d.plans.peek("room-1")).toBeDefined();
  });
});

describe("a dry run that is not a clean pass queues nothing", () => {
  it.each([
    ["a revert", simulateRevert],
    ["an unreachable simulator", simulateUnavailable],
    ["insufficient balance", simulateInsufficientBalance],
    ["an unrecognised shape", { totally: "unexpected" }],
  ])("%s", async (_label, response) => {
    const { client } = recordingClient({ execute_transfer: response });
    const d = deps(client);

    const result = await createSimulateAction(d).handler(
      runtimeReturning(TRANSFER_EXTRACTION),
      message("send 0.05 ETH")
    );

    expect((result as { success: boolean }).success).toBe(false);
    expect(d.plans.peek("room-1")).toBeUndefined();
  });

  it("names an unreachable simulator as such, not as a revert", async () => {
    const { client } = recordingClient({ execute_transfer: simulateUnavailable });
    const result = await createSimulateAction(deps(client)).handler(
      runtimeReturning(TRANSFER_EXTRACTION),
      message("send 0.05 ETH")
    );
    const text = (result as { text?: string }).text ?? "";
    expect(text).toContain("could not reach the chain");
    expect(text).not.toContain("would revert");
  });

  it("reports the shortfall when the balance is too low", async () => {
    const { client } = recordingClient({
      execute_transfer: simulateInsufficientBalance,
    });
    const result = await createSimulateAction(deps(client)).handler(
      runtimeReturning(TRANSFER_EXTRACTION),
      message("send 1 ETH")
    );
    expect((result as { text?: string }).text).toContain("short by     0.75 ETH");
  });
});

describe("the model cannot reach the chain with a malformed payload", () => {
  it.each([
    ["a negative amount", `{"to_address":"${RECIPIENT}","amount":"-5"}`],
    ["a truncated address", '{"to_address":"0x1c7D4B19","amount":"1"}'],
    ["prose instead of JSON", "sure, sending 1 ETH now"],
  ])("%s never produces a call", async (_label, extraction) => {
    const { client, calls } = recordingClient({ execute_transfer: simulateSuccess });
    const d = deps(client);

    await createSimulateAction(d).handler(runtimeReturning(extraction), message("send funds"));

    expect(calls).toHaveLength(0);
    expect(d.plans.peek("room-1")).toBeUndefined();
  });
});

describe("KEEPERHUB_CONFIRM", () => {
  it.each([
    ["transfer", createSimulateAction, "execute_transfer", TRANSFER_EXTRACTION, "send 0.05 ETH"],
    ["contract call", createContractCallAction, "execute_contract_call", CALL_EXTRACTION, "call approve"],
    [
      "conditional",
      createCheckAndExecuteAction,
      "execute_check_and_execute",
      CONDITIONAL_EXTRACTION,
      "if the balance is above 1000 then transfer",
    ],
  ])("replays the reviewed %s payload byte for byte", async (
    _label,
    factory,
    tool,
    extraction,
    text
  ) => {
    const { client, calls } = recordingClient({
      [tool]: simulateSuccess,
    });
    const d = deps(client);
    await factory(d).handler(runtimeReturning(extraction), message(text));

    // The broadcast leg answers with an execute response, not a simulation.
    const broadcasting = recordingClient({ [tool]: executeCompleted });
    const confirmDeps = { ...d, getClient: () => broadcasting.client };
    await createConfirmAction(confirmDeps).handler(runtimeReturning(""), message("confirm"));

    const dryRun = calls[0]?.args ?? {};
    const broadcast = broadcasting.calls[0]?.args ?? {};
    const { simulate: _s, ...dryRunRest } = dryRun;
    const { idempotency_key: key, ...broadcastRest } = broadcast;

    expect(broadcastRest).toEqual(dryRunRest);
    expect(typeof key).toBe("string");
    expect(broadcast.simulate).toBeUndefined();
  });

  it("refuses when no plan was reviewed", async () => {
    const { client, calls } = recordingClient({ execute_transfer: executeCompleted });
    const result = await createConfirmAction(deps(client)).handler(
      runtimeReturning(""),
      message("confirm")
    );
    expect(calls).toHaveLength(0);
    expect((result as { success: boolean }).success).toBe(false);
  });

  it("does not validate on an ambiguous reply even with a plan pending", async () => {
    const { client } = recordingClient({ execute_transfer: simulateSuccess });
    const d = deps(client);
    await createSimulateAction(d).handler(
      runtimeReturning(TRANSFER_EXTRACTION),
      message("send 0.05 ETH")
    );
    const confirm = createConfirmAction(d);

    await expect(confirm.validate(runtimeReturning(""), message("hmm, maybe later"))).resolves.toBe(false);
    await expect(confirm.validate(runtimeReturning(""), message("confirm"))).resolves.toBe(true);
  });

  it("consumes the plan so a second approval cannot broadcast twice", async () => {
    const { client } = recordingClient({ execute_transfer: simulateSuccess });
    const d = deps(client);
    await createSimulateAction(d).handler(
      runtimeReturning(TRANSFER_EXTRACTION),
      message("send 0.05 ETH")
    );

    const broadcasting = recordingClient({ execute_transfer: executeCompleted });
    const confirm = createConfirmAction({ ...d, getClient: () => broadcasting.client });
    await confirm.handler(runtimeReturning(""), message("confirm"));
    await confirm.handler(runtimeReturning(""), message("confirm"));

    expect(broadcasting.calls).toHaveLength(1);
  });

  it("treats an unconfirmed broadcast as in flight, never as a failure", async () => {
    const { client } = recordingClient({ execute_transfer: simulateSuccess });
    const d = deps(client);
    await createSimulateAction(d).handler(
      runtimeReturning(TRANSFER_EXTRACTION),
      message("send 0.05 ETH")
    );

    const broadcasting = recordingClient({ execute_transfer: executeUnconfirmed });
    const result = await createConfirmAction({
      ...d,
      getClient: () => broadcasting.client,
    }).handler(runtimeReturning(""), message("confirm"));

    // Not a failure: reporting a live transaction as failed invites a re-send.
    expect((result as { success: boolean }).success).toBe(true);
    const text = (result as { text?: string }).text ?? "";
    expect(text).toContain("not yet confirmed");
    expect(text).toContain("Do not re-send");
    expect(d.executions.get("room-1")).toBe("exec_unconfirmed_1");
  });

  it("reports a settled failure as a failure", async () => {
    const { client } = recordingClient({ execute_transfer: simulateSuccess });
    const d = deps(client);
    await createSimulateAction(d).handler(
      runtimeReturning(TRANSFER_EXTRACTION),
      message("send 0.05 ETH")
    );

    const broadcasting = recordingClient({ execute_transfer: executeFailed });
    const result = await createConfirmAction({
      ...d,
      getClient: () => broadcasting.client,
    }).handler(runtimeReturning(""), message("confirm"));

    expect((result as { success: boolean }).success).toBe(false);
    expect((result as { text?: string }).text).toContain("reverted on chain");
  });

  it("keeps the plan when the outcome is not definite, so a retry reuses the key", async () => {
    const { client } = recordingClient({ execute_transfer: simulateSuccess });
    const d = deps(client);
    await createSimulateAction(d).handler(
      runtimeReturning(TRANSFER_EXTRACTION),
      message("send 0.05 ETH")
    );

    const broadcasting = recordingClient({
      execute_transfer: new Error("gateway timeout"),
    });
    const result = await createConfirmAction({
      ...d,
      getClient: () => broadcasting.client,
    }).handler(runtimeReturning(""), message("confirm"));

    expect((result as { success: boolean }).success).toBe(false);
    // Rotating the key after an ambiguous outcome is what turns one intent
    // into two transactions, so the plan survives.
    expect(d.plans.peek("room-1")).toBeDefined();
    expect((result as { text?: string }).text).toContain("check the status");
  });

  it("derives the same idempotency key on every attempt at one plan", async () => {
    const { client } = recordingClient({ execute_transfer: simulateSuccess });
    const d = deps(client);
    await createSimulateAction(d).handler(
      runtimeReturning(TRANSFER_EXTRACTION),
      message("send 0.05 ETH")
    );

    const broadcasting = recordingClient({
      execute_transfer: new Error("gateway timeout"),
    });
    const confirm = createConfirmAction({ ...d, getClient: () => broadcasting.client });
    await confirm.handler(runtimeReturning(""), message("confirm"));
    await confirm.handler(runtimeReturning(""), message("confirm"));

    expect(broadcasting.calls).toHaveLength(2);
    const first = broadcasting.calls[0]?.args.idempotency_key;
    const second = broadcasting.calls[1]?.args.idempotency_key;
    expect(typeof first).toBe("string");
    // The whole point: a retry must not look like new work.
    expect(second).toBe(first);
  });

  it("gives two separate dry runs of the same transfer different keys", async () => {
    const run = async () => {
      const { client } = recordingClient({ execute_transfer: simulateSuccess });
      const d = deps(client);
      await createSimulateAction(d).handler(
        runtimeReturning(TRANSFER_EXTRACTION),
        message("send 0.05 ETH")
      );
      const broadcasting = recordingClient({ execute_transfer: executeCompleted });
      await createConfirmAction({ ...d, getClient: () => broadcasting.client }).handler(
        runtimeReturning(""),
        message("confirm")
      );
      return broadcasting.calls[0]?.args.idempotency_key;
    };

    // Two deliberate identical transfers are different work and must not
    // collide inside the 24-hour replay window.
    expect(await run()).not.toBe(await run());
  });

  it("keeps the plan and does not double-send when a request is already in progress", async () => {
    const { client } = recordingClient({ execute_transfer: simulateSuccess });
    const d = deps(client);
    await createSimulateAction(d).handler(
      runtimeReturning(TRANSFER_EXTRACTION),
      message("send 0.05 ETH")
    );

    const broadcasting = recordingClient({ execute_transfer: errorInProgress });
    const result = await createConfirmAction({
      ...d,
      getClient: () => broadcasting.client,
    }).handler(runtimeReturning(""), message("confirm"));

    expect((result as { text?: string }).text).toContain("already in progress");
    expect((result as { text?: string }).text).toContain("Nothing was sent twice");
    expect(d.plans.peek("room-1")).toBeDefined();
  });

  it("discards the plan on a conflict, which retrying cannot fix", async () => {
    const { client } = recordingClient({ execute_transfer: simulateSuccess });
    const d = deps(client);
    await createSimulateAction(d).handler(
      runtimeReturning(TRANSFER_EXTRACTION),
      message("send 0.05 ETH")
    );

    const broadcasting = recordingClient({ execute_transfer: errorConflict });
    const result = await createConfirmAction({
      ...d,
      getClient: () => broadcasting.client,
    }).handler(runtimeReturning(""), message("confirm"));

    expect(d.plans.peek("room-1")).toBeUndefined();
    expect((result as { text?: string }).text).toContain("exec_original_1");
    expect(d.executions.get("room-1")).toBe("exec_original_1");
  });

  it("names a scope refusal rather than reporting a generic failure", async () => {
    const { client } = recordingClient({ execute_transfer: simulateSuccess });
    const d = deps(client);
    await createSimulateAction(d).handler(
      runtimeReturning(TRANSFER_EXTRACTION),
      message("send 0.05 ETH")
    );

    const broadcasting = recordingClient({ execute_transfer: errorInsufficientScope });
    const result = await createConfirmAction({
      ...d,
      getClient: () => broadcasting.client,
    }).handler(runtimeReturning(""), message("confirm"));

    expect((result as { text?: string }).text).toContain("mcp:write");
    expect((result as { text?: string }).text).toContain("Nothing was sent");
  });

  it("says when a response is a replay rather than a fresh outcome", async () => {
    const { client } = recordingClient({ execute_transfer: simulateSuccess });
    const d = deps(client);
    await createSimulateAction(d).handler(
      runtimeReturning(TRANSFER_EXTRACTION),
      message("send 0.05 ETH")
    );

    const broadcasting = recordingClient({ execute_transfer: executeReplayed });
    const result = await createConfirmAction({
      ...d,
      getClient: () => broadcasting.client,
    }).handler(runtimeReturning(""), message("confirm"));

    expect((result as { text?: string }).text).toContain("replay");
    expect((result as { text?: string }).text).toContain("Nothing was sent again");
  });
});

describe("KEEPERHUB_STATUS", () => {
  it("does not validate before anything has been executed", async () => {
    const { client } = recordingClient({});
    await expect(
      createStatusAction(deps(client)).validate(runtimeReturning(""), message("did it land?"))
    ).resolves.toBe(false);
  });

  it("reports the settled status of the execution started in this room", async () => {
    const { client } = recordingClient({
      get_direct_execution_status: executionStatusCompleted,
    });
    const d = deps(client);
    d.executions.put("room-1", "exec_unconfirmed_1");
    const status = createStatusAction(d);

    await expect(status.validate(runtimeReturning(""), message("did it land?"))).resolves.toBe(true);
    const result = await status.handler(runtimeReturning(""), message("did it land?"));

    const text = (result as { text?: string }).text ?? "";
    expect(text).toContain("is completed");
    expect(text).toContain("0xdef456");
  });
});

describe("action routing", () => {
  it("routes a conditional request away from the plain contract-call action", async () => {
    const { client } = recordingClient({});
    const d = deps(client);
    const conditional = message("if balanceOf is above 1000 then call transfer");

    await expect(
      createContractCallAction(d).validate(runtimeReturning(""), conditional)
    ).resolves.toBe(false);
    await expect(
      createCheckAndExecuteAction(d).validate(runtimeReturning(""), conditional)
    ).resolves.toBe(true);
  });

  it("does not validate any action when nothing suggests onchain work", async () => {
    const { client } = recordingClient({});
    const d = deps(client);
    const idle = message("what is the weather today");

    for (const factory of [
      createSimulateAction,
      createContractCallAction,
      createCheckAndExecuteAction,
      createConfirmAction,
      createStatusAction,
    ]) {
      await expect(factory(d).validate(runtimeReturning(""), idle)).resolves.toBe(false);
    }
  });
});


describe("results that are not simulations", () => {
  it("reports a view call's value and queues nothing to approve", async () => {
    const { client } = recordingClient({ execute_contract_call: readResult });
    const d = deps(client);

    const result = await createContractCallAction(d).handler(
      runtimeReturning(CALL_EXTRACTION),
      message("call balanceOf")
    );

    expect((result as { success: boolean }).success).toBe(true);
    expect((result as { text?: string }).text).toContain("read-only call");
    expect((result as { text?: string }).text).toContain("1500000000000000000");
    expect(d.plans.peek("room-1")).toBeUndefined();
  });

  it("reports a condition that does not hold and queues nothing", async () => {
    const { client } = recordingClient({ execute_check_and_execute: conditionNotMet });
    const d = deps(client);

    const result = await createCheckAndExecuteAction(d).handler(
      runtimeReturning(CONDITIONAL_EXTRACTION),
      message("if the balance is above 1000 then transfer")
    );

    expect((result as { success: boolean }).success).toBe(true);
    expect((result as { text?: string }).text).toContain("does not hold");
    expect((result as { text?: string }).text).toContain("observed     500000000000000000");
    expect(d.plans.peek("room-1")).toBeUndefined();
  });
});

describe("Solana", () => {
  it("declines rather than broadcasting something it could not dry run", async () => {
    const { client, calls } = recordingClient({ execute_transfer: simulateSuccess });
    const d = deps(client);

    const result = await createSimulateAction(d).handler(
      runtimeReturning(`{"to_address":"${RECIPIENT}","amount":"0.05","chain_id":"101"}`),
      message("send 0.05 SOL")
    );

    // Refused before any call: the dry run is the safety property, so a chain
    // that cannot be dry run is refused rather than silently broadcast.
    expect(calls).toHaveLength(0);
    expect((result as { success: boolean }).success).toBe(false);
    expect((result as { text?: string }).text).toContain("EVM-only");
    expect(d.plans.peek("room-1")).toBeUndefined();
  });
});

describe("receipts are surfaced as the authoritative proof", () => {
  it("renders verified receipt status alongside the self-reported hash", async () => {
    const { client } = recordingClient({
      get_direct_execution_status: executionStatusWithReceipts,
    });
    const d = deps(client);
    d.executions.put("room-1", "exec_unconfirmed_1");

    const result = await createStatusAction(d).handler(
      runtimeReturning(""),
      message("did it land?")
    );

    const text = (result as { text?: string }).text ?? "";
    expect(text).toContain("receipts");
    expect(text).toContain("success, verified");
    expect(text).toContain("block 1234567");
  });

  it("says plainly when nothing has been verified against the chain", async () => {
    const { client } = recordingClient({
      get_direct_execution_status: executionStatusCompleted,
    });
    const d = deps(client);
    d.executions.put("room-1", "exec_unconfirmed_1");

    const result = await createStatusAction(d).handler(
      runtimeReturning(""),
      message("did it land?")
    );

    expect((result as { text?: string }).text).toContain("none yet");
  });
});


describe("a real production failure body", () => {
  it("recovers the simulation from the embedded JSON and reports the shortfall", async () => {
    const { client } = recordingClient({
      execute_transfer: liveInsufficientBalanceError,
    });
    const d = deps(client);

    const result = await createSimulateAction(d).handler(
      runtimeReturning(TRANSFER_EXTRACTION),
      message("send 0.05 ETH")
    );

    const text = (result as { text?: string }).text ?? "";
    // The rich reason survives, rather than degrading to a bare status line.
    expect(text).toContain("short by     0.000001 ETH");
    expect(text).toContain("balance      0 ETH");
    expect(text).toContain("did not pass validation");
    expect(text).toContain("Nothing is queued");
    expect(d.plans.peek("room-1")).toBeUndefined();
  });
});
