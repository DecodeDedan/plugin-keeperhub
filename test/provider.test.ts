import { describe, expect, it } from "vitest";
import { createExecutionMemoryEvaluator } from "../src/evaluator.js";
import { createExecutionTracker } from "../src/plan.js";
import { createWalletProvider } from "../src/provider.js";
import { integrations, message, recordingClient, runtimeReturning, spendCap } from "./fixtures.js";

const EMPTY_STATE = { values: {}, data: {}, text: "" } as never;

describe("KEEPERHUB_WALLET provider", () => {
  it("reports wallets, the enforced cap and the remaining headroom", async () => {
    const { client } = recordingClient({
      get_spending_limits: spendCap,
      list_integrations: integrations,
    });
    const result = await createWalletProvider(() => client).get(
      runtimeReturning(""),
      message("anything"),
      EMPTY_STATE
    );

    expect(result.text).toContain("Treasury");
    expect(result.text).toContain("remaining    0.75 ETH");
    expect(result.values?.keeperhubWalletCount).toBe(1);
    expect(result.values?.keeperhubRemainingWei).toBe("750000000000000000");
  });

  it("excludes integrations that are not wallets", async () => {
    const { client } = recordingClient({
      get_spending_limits: spendCap,
      list_integrations: integrations,
    });
    const result = await createWalletProvider(() => client).get(
      runtimeReturning(""),
      message("anything"),
      EMPTY_STATE
    );
    expect(result.text).not.toContain("Alerts");
  });

  it("says execution is unavailable when nothing is configured", async () => {
    const result = await createWalletProvider(() => undefined).get(
      runtimeReturning(""),
      message("anything"),
      EMPTY_STATE
    );
    expect(result.values?.keeperhubConfigured).toBe(false);
    expect(result.text).toContain("not configured");
  });

  it("degrades to a notice instead of throwing when KeeperHub is unreachable", async () => {
    const { client } = recordingClient({
      get_spending_limits: new Error("connection refused"),
      list_integrations: new Error("connection refused"),
    });
    const result = await createWalletProvider(() => client).get(
      runtimeReturning(""),
      message("anything"),
      EMPTY_STATE
    );
    expect(result.text).toContain("unreachable");
  });

  it("warns that a default cap is still a cap", async () => {
    const { client } = recordingClient({
      get_spending_limits: { ...spendCap, dailyCapWei: null, usingDefaultDailyCap: true },
      list_integrations: integrations,
    });
    const result = await createWalletProvider(() => client).get(
      runtimeReturning(""),
      message("anything"),
      EMPTY_STATE
    );
    expect(result.text).toContain("It is not unlimited");
  });
});

describe("KEEPERHUB_RECORD_EXECUTION evaluator", () => {
  it("does not run before anything has been executed", async () => {
    const evaluator = createExecutionMemoryEvaluator(createExecutionTracker());
    await expect(evaluator.validate(runtimeReturning(""), message("hi"))).resolves.toBe(false);
  });

  it("writes the execution into agent memory once one exists", async () => {
    const executions = createExecutionTracker();
    executions.put("room-1", "exec_1");
    const evaluator = createExecutionMemoryEvaluator(executions);
    const runtime = runtimeReturning("") as unknown as {
      createMemory: (memory: unknown, table?: string) => Promise<void>;
    };

    await expect(evaluator.validate(runtime as never, message("hi"))).resolves.toBe(true);
    const result = await evaluator.handler(runtime as never, message("hi"));

    expect((result as { success: boolean }).success).toBe(true);
    expect(runtime.createMemory).toHaveBeenCalledTimes(1);
    const [memory, table] = (runtime.createMemory as unknown as { mock: { calls: unknown[][] } })
      .mock.calls[0] as [{ content: { text: string } }, string];
    expect(memory.content.text).toContain("exec_1");
    expect(table).toBe("facts");
  });
});
