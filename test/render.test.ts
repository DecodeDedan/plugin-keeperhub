import { describe, expect, it } from "vitest";
import {
  parseExecuteResponse,
  parseIntegrations,
  parseSimulateResult,
  parseSpendCap,
} from "../src/keeperhub-types.js";
import {
  formatWei,
  renderExecuteResponse,
  renderSimulateFailure,
  renderSpendCap,
  subtractWei,
} from "../src/render.js";
import {
  executeFailed,
  executeUnconfirmed,
  integrations,
  simulateRevert,
  simulateSuccess,
  simulateUnavailable,
  spendCap,
} from "./fixtures.js";

describe("formatWei", () => {
  it.each([
    ["1000000000000000000", "1"],
    ["50000000000000000", "0.05"],
    ["1", "0.000000000000000001"],
    ["0", "0"],
    ["1500000000000000000", "1.5"],
  ])("renders %s wei as %s", (wei, expected) => {
    expect(formatWei(wei)).toBe(expected);
  });

  it("keeps full precision on a value beyond exact float range", () => {
    // 2^53 + 1 wei: a double cannot hold this integer exactly.
    expect(formatWei("9007199254740993")).toBe("0.009007199254740993");
  });

  it("returns a non-numeric input unchanged rather than inventing a number", () => {
    expect(formatWei("not-a-number")).toBe("not-a-number");
  });
});

describe("subtractWei", () => {
  it("subtracts without precision loss", () => {
    expect(subtractWei("1000000000000000000", "250000000000000000")).toBe(
      "750000000000000000"
    );
  });

  it("clamps at zero rather than reporting negative headroom", () => {
    expect(subtractWei("1", "5")).toBe("0");
  });
});

describe("renderSpendCap", () => {
  it("reports cap, usage and the remaining headroom", () => {
    const cap = parseSpendCap(spendCap);
    expect(cap).toBeDefined();
    const lines = renderSpendCap(cap as NonNullable<typeof cap>).join("\n");
    expect(lines).toContain("daily cap    1 ETH");
    expect(lines).toContain("used today   0.25 ETH");
    expect(lines).toContain("remaining    0.75 ETH");
  });
});

describe("renderSimulateFailure", () => {
  it("distinguishes a revert from an unreachable simulator", () => {
    const revert = parseSimulateResult(simulateRevert);
    const unavailable = parseSimulateResult(simulateUnavailable);

    const revertText = renderSimulateFailure(revert as never);
    const unavailableText = renderSimulateFailure(unavailable as never);

    expect(revertText).toContain("would revert");
    expect(revertText).toContain("ERC20: insufficient allowance");
    expect(unavailableText).toContain("could not reach the chain");
    expect(unavailableText).not.toContain("would revert");
  });
});

describe("renderExecuteResponse", () => {
  it("never presents an unconfirmed broadcast as final", () => {
    const parsed = parseExecuteResponse(executeUnconfirmed);
    const text = renderExecuteResponse(parsed as never);
    expect(text).toContain("not yet confirmed");
    expect(text).toContain("Do not re-send");
    expect(text).not.toContain("confirmed it");
  });

  it("surfaces the error on a settled failure", () => {
    const parsed = parseExecuteResponse(executeFailed);
    expect(renderExecuteResponse(parsed as never)).toContain("reverted on chain");
  });
});

describe("guards reject shapes they do not recognise", () => {
  it("refuses a simulate response that is not a simulation", () => {
    expect(parseSimulateResult({ success: true })).toBeUndefined();
    expect(parseSimulateResult({ status: "completed", success: true })).toBeUndefined();
    expect(parseSimulateResult(null)).toBeUndefined();
  });

  it("accepts the real simulate shapes", () => {
    expect(parseSimulateResult(simulateSuccess)?.success).toBe(true);
    expect(parseSimulateResult(simulateRevert)?.success).toBe(false);
  });

  it("refuses an execute response with an unknown status", () => {
    expect(
      parseExecuteResponse({ executionId: "x", status: "definitely-not-a-status" })
    ).toBeUndefined();
    expect(parseExecuteResponse({ status: "completed" })).toBeUndefined();
  });

  it("refuses a spend cap missing the enforced figures", () => {
    expect(parseSpendCap({ dailyCapWei: "1" })).toBeUndefined();
  });

  it("reads the integrations array and ignores malformed entries", () => {
    const parsed = parseIntegrations([...integrations, null, { name: "no id" }]);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.address).toBe(integrations[0].address);
  });

  it("returns nothing for a non-array integrations payload", () => {
    expect(parseIntegrations({ integrations: [] })).toEqual([]);
  });
});
