import { describe, expect, it } from "vitest";
import {
  CanonicalizationError,
  canonicalizeAddress,
  canonicalizeAmount,
  canonicalizeChainId,
  canonicalizeTaskId,
  canonicalString,
  deriveIdempotencyKey,
} from "../src/idempotency.js";

describe("canonicalizeAmount", () => {
  it.each([
    [".5", "0.5"],
    ["01.5", "1.5"],
    ["007", "7"],
    ["0.0010", "0.001"],
    ["1.000", "1"],
    ["0", "0"],
    ["0.0", "0"],
    ["0.000", "0"],
    ["  0.1  ", "0.1"],
    ["1", "1"],
    ["0.100000000000000006", "0.100000000000000006"],
  ])("canonicalizes %s to %s", (input, expected) => {
    expect(canonicalizeAmount(input)).toBe(expected);
  });

  it("keeps eighteen-decimal amounts distinct, which a float would collapse", () => {
    const a = canonicalizeAmount("0.000000000000000001");
    const b = canonicalizeAmount("0.000000000000000002");
    expect(a).not.toBe(b);
  });

  it.each([
    ["a leading plus", "+1"],
    ["a leading minus", "-1"],
    ["exponent notation", "1e18"],
    ["a thousands separator", "1,000"],
    ["no digits at all", "."],
    ["letters", "1abc"],
  ])("rejects %s", (_label, input) => {
    expect(() => canonicalizeAmount(input)).toThrow(CanonicalizationError);
  });
});

describe("canonicalizeChainId", () => {
  it.each([
    ["8453", "8453"],
    ["08453", "8453"],
    [" 1 ", "1"],
    ["0", "0"],
  ])("canonicalizes %s to %s", (input, expected) => {
    expect(canonicalizeChainId(input)).toBe(expected);
  });

  it("refuses an unresolved chain alias rather than hashing the alias", () => {
    expect(() => canonicalizeChainId("base")).toThrow(CanonicalizationError);
  });
});

describe("canonicalizeAddress", () => {
  it("agrees between checksummed and unchecksummed forms", () => {
    expect(canonicalizeAddress("0xAbCdEf0123456789abcdef0123456789ABCDEF01")).toBe(
      canonicalizeAddress("0xabcdef0123456789abcdef0123456789abcdef01")
    );
  });
});

describe("canonicalizeTaskId", () => {
  it("percent-encodes the separator so a task id cannot shift later fields", () => {
    expect(canonicalizeTaskId("8453|0xabc")).toBe("8453%7C0xabc");
  });

  it("percent-encodes the percent sign before the separator", () => {
    expect(canonicalizeTaskId("a%b|c")).toBe("a%25b%7Cc");
  });

  it("does not case-fold, because task ids are opaque", () => {
    expect(canonicalizeTaskId("Invoice-A")).toBe("Invoice-A");
  });

  it("keeps a bar-containing task id distinct from a differently-split one", () => {
    // The documented collision: "8453|0xabc" on chain 1 must not join to the
    // same string as task "8453" on chain 8453 with recipient 0xabc.
    const a = canonicalString("8453|0xabc", "execute_transfer", {
      chain_id: "1",
      to_address: "0xdead",
      amount: "1",
    });
    const b = canonicalString("8453", "execute_transfer", {
      chain_id: "8453",
      to_address: "0xdead",
      amount: "1",
    });
    expect(a).not.toBe(b);
  });
});

describe("canonicalString", () => {
  it("joins with a bare vertical bar and fixed positions", () => {
    expect(
      canonicalString("task-1", "execute_transfer", {
        chain_id: "11155111",
        to_address: "0xABCDEF0123456789abcdef0123456789ABCDEF01",
        amount: "0.0100",
      })
    ).toBe("task-1|11155111|0xabcdef0123456789abcdef0123456789abcdef01|0.01|");
  });

  it("holds separator positions when an optional field is absent", () => {
    const withToken = canonicalString("t", "execute_transfer", {
      chain_id: "1",
      to_address: "0xa",
      amount: "1",
      token_address: "0xB",
    });
    const withoutToken = canonicalString("t", "execute_transfer", {
      chain_id: "1",
      to_address: "0xa",
      amount: "1",
    });
    expect(withToken.split("|")).toHaveLength(5);
    expect(withoutToken.split("|")).toHaveLength(5);
    expect(withoutToken.endsWith("|")).toBe(true);
  });

  it("refuses a tool it has no effect-field rule for", () => {
    expect(() => canonicalString("t", "execute_protocol_action", {})).toThrow(
      CanonicalizationError
    );
  });
});

describe("deriveIdempotencyKey", () => {
  const args = {
    chain_id: "11155111",
    to_address: "0xABCDEF0123456789abcdef0123456789ABCDEF01",
    amount: "0.01",
  };

  it("is a lowercase hex sha-256 digest", () => {
    expect(deriveIdempotencyKey("task-1", "execute_transfer", args)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable across attempts, which is the whole point", () => {
    const first = deriveIdempotencyKey("task-1", "execute_transfer", args);
    const second = deriveIdempotencyKey("task-1", "execute_transfer", args);
    expect(second).toBe(first);
  });

  it("agrees across spellings that mean the same transfer", () => {
    const checksummed = deriveIdempotencyKey("task-1", "execute_transfer", args);
    const loose = deriveIdempotencyKey("task-1", "execute_transfer", {
      chain_id: "011155111",
      to_address: "0xabcdef0123456789abcdef0123456789abcdef01",
      amount: "0.0100",
    });
    expect(loose).toBe(checksummed);
  });

  it("differs for different work", () => {
    const original = deriveIdempotencyKey("task-1", "execute_transfer", args);
    expect(deriveIdempotencyKey("task-2", "execute_transfer", args)).not.toBe(original);
    expect(
      deriveIdempotencyKey("task-1", "execute_transfer", { ...args, amount: "0.02" })
    ).not.toBe(original);
  });
});
