import { describe, expect, it } from "vitest";
import { KeeperHubClient, readConfig } from "../src/client.js";
import {
  INSUFFICIENT_BALANCE,
  parseIntegrations,
  parseSimulateResult,
  parseSpendCap,
  recoverErrorBody,
} from "../src/keeperhub-types.js";

/**
 * Runs against a real KeeperHub organization.
 *
 * Every faked test in this suite asserts that the plugin sends what it
 * intends to send. None of them can catch KeeperHub changing a field name --
 * which is exactly the class of bug that produced the rewrite these tests
 * came from. This file closes that gap by checking the live contract.
 *
 * It is safe to run: every call here is a read or a dry run with
 * `simulate: true`, so no value moves. There is deliberately no broadcast
 * path in this file at all.
 *
 *   KEEPERHUB_API_KEY=kh_... pnpm test
 *
 * Without that variable the suite skips rather than failing, so a clone with
 * no credentials still has a green, meaningful test run.
 */

const config = readConfig((key) => process.env[key]);
const live = config ? describe : describe.skip;

live("live KeeperHub contract", () => {
  const client = new KeeperHubClient(config as NonNullable<typeof config>);

  /**
   * Dry run a minimal transfer from the organization wallet to itself.
   *
   * A self-transfer keeps the call meaningful without needing a second
   * address, and `simulate: true` means nothing is signed or broadcast either
   * way. Returns the parsed simulation whether KeeperHub answered with a
   * success body or an error carrying the body inside its message.
   */
  async function dryRunSelfTransfer() {
    const listed = await client.callTool("list_integrations", {});
    const wallets = parseIntegrations(listed.ok ? listed.data : undefined).filter(
      (i) => i.type === "web3" && i.address
    );
    if (wallets.length === 0) {
      return;
    }

    const response = await client.callTool("execute_transfer", {
      chain_id: config?.defaultChainId,
      to_address: wallets[0]?.address ?? "",
      amount: "0.000001",
      simulate: true,
    });

    return parseSimulateResult(
      recoverErrorBody(response.data, response.ok ? undefined : response.error)
    );
  }

  it("reads spending limits in the shape the plugin parses", async () => {
    const response = await client.callTool("get_spending_limits", {});
    expect(response.ok, `get_spending_limits failed: ${response.ok ? "" : response.error}`).toBe(true);

    const cap = parseSpendCap(response.ok ? response.data : undefined);
    expect(
      cap,
      "get_spending_limits returned a shape the plugin cannot parse; re-check lib/analytics/queries.ts getSpendCapData"
    ).toBeDefined();
    expect(cap?.effectiveDailyCapWei).toMatch(/^\d+$/);
    expect(cap?.dailyUsedWei).toMatch(/^\d+$/);
  }, 30_000);

  it("lists integrations as an array the plugin can read", async () => {
    const response = await client.callTool("list_integrations", {});
    expect(response.ok, `list_integrations failed: ${response.ok ? "" : response.error}`).toBe(true);

    const parsed = parseIntegrations(response.ok ? response.data : undefined);
    expect(
      Array.isArray(parsed),
      "list_integrations no longer returns a bare array; re-check app/api/integrations/route.ts"
    ).toBe(true);
  }, 30_000);

  it("returns a parsable simulation envelope for a dry-run transfer, moving nothing", async () => {
    const simulation = await dryRunSelfTransfer();

    // A dry run on an unfunded wallet legitimately does not pass, and arrives
    // as a tool error with the JSON embedded in a longer message. What this
    // test checks is the CONTRACT -- that whatever KeeperHub answered still
    // parses into the shape the plugin acts on -- not that the organization
    // happens to hold funds.
    expect(
      simulation,
      "execute_transfer answered in a shape the plugin cannot parse; re-check lib/execute/simulate.ts"
    ).toBeDefined();
    expect(simulation?.status).toBe("simulated");
  }, 60_000);

  it("recovers the machine-readable cause when a dry run does not pass", async () => {
    const simulation = await dryRunSelfTransfer();
    if (!simulation || simulation.success) {
      return;
    }

    // Whatever the cause, the fields the plugin branches on must be present.
    expect(["validation", "revert", "unavailable"]).toContain(simulation.failureKind);
    expect(typeof simulation.error).toBe("string");
    if (simulation.code === INSUFFICIENT_BALANCE) {
      expect(simulation.shortfallWei).toMatch(/^\d+$/);
      expect(simulation.nativeSymbol).toBeDefined();
    }
  }, 60_000);

  /**
   * Readiness rather than correctness: it reports whether the organization can
   * actually move value today. Skipped when the wallet is unfunded, so an
   * empty treasury does not turn the suite red and mask a real regression.
   */
  it("has a wallet funded enough to broadcast", async (ctx) => {
    const simulation = await dryRunSelfTransfer();
    if (simulation && !simulation.success && simulation.code === INSUFFICIENT_BALANCE) {
      ctx.skip(
        true,
        `wallet is unfunded: ${simulation.revertReason ?? simulation.error}`
      );
      return;
    }
    expect(simulation?.success, simulation && !simulation.success ? simulation.error : undefined).toBe(true);
  }, 60_000);

  it("closes cleanly", async () => {
    await expect(client.close()).resolves.toBeUndefined();
  });
});
