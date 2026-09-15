import { describe, expect, it } from "vitest";
import { parseTransferIntent } from "../src/extract.js";

const ADDR = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";

describe("parseTransferIntent", () => {
  it("accepts a well formed intent", () => {
    const result = parseTransferIntent(`{"to_address":"${ADDR}","amount":"0.1"}`);
    expect(result).toEqual({
      ok: true,
      intent: { to_address: ADDR, amount: "0.1" },
    });
  });

  it("unwraps a fenced response", () => {
    const result = parseTransferIntent(
      "```json\n{\"to_address\":\"" + ADDR + "\",\"amount\":\"1\"}\n```"
    );
    expect(result.ok).toBe(true);
  });

  it("treats null as no intent rather than an error", () => {
    expect(parseTransferIntent("null")).toEqual({
      ok: false,
      reason: "no transfer intent in message",
    });
  });

  // Each of these is a way a model can lose money if the shape is trusted.
  it.each([
    ["negative amount", `{"to_address":"${ADDR}","amount":"-1"}`],
    ["zero amount", `{"to_address":"${ADDR}","amount":"0"}`],
    ["scientific notation", `{"to_address":"${ADDR}","amount":"1e18"}`],
    ["amount as a number", `{"to_address":"${ADDR}","amount":0.1}`],
    ["thousands separator", `{"to_address":"${ADDR}","amount":"1,000"}`],
    ["truncated address", '{"to_address":"0x1c7D4B19","amount":"1"}'],
    ["missing recipient", '{"amount":"1"}'],
    ["missing amount", `{"to_address":"${ADDR}"}`],
    ["not json", "sure, sending 1 ETH now"],
  ])("rejects %s", (_label, raw) => {
    expect(parseTransferIntent(raw).ok).toBe(false);
  });

  it("rejects a malformed chain id", () => {
    const result = parseTransferIntent(
      `{"to_address":"${ADDR}","amount":"1","chain_id":"base"}`
    );
    expect(result.ok).toBe(false);
  });
});
