import { describe, expect, it } from "vitest";
import { broadcastArgs, createPlanStore, type PendingPlan } from "../src/plan.js";

const plan = (createdAt = Date.now()): PendingPlan => ({
  tool: "execute_transfer",
  args: { chain_id: "11155111", to_address: "0xabc", amount: "0.1", simulate: true },
  summary: "move 0.1",
  createdAt,
});

describe("plan store", () => {
  it("returns a stored plan", () => {
    const store = createPlanStore();
    store.put("room", plan());
    expect(store.peek("room")).toBeDefined();
  });

  it("yields a plan only once, so a repeated approval cannot replay it", () => {
    const store = createPlanStore();
    store.put("room", plan());
    expect(store.take("room")).toBeDefined();
    expect(store.take("room")).toBeUndefined();
  });

  it("expires a plan that is older than its ttl", () => {
    const store = createPlanStore(1000);
    const now = Date.now();
    store.put("room", plan(now - 5000));
    expect(store.peek("room", now)).toBeUndefined();
  });

  it("keeps rooms isolated", () => {
    const store = createPlanStore();
    store.put("room-a", plan());
    expect(store.peek("room-b")).toBeUndefined();
  });
});

describe("broadcastArgs", () => {
  it("drops simulate and attaches the idempotency key, changing nothing else", () => {
    expect(broadcastArgs(plan(), "key-1")).toEqual({
      chain_id: "11155111",
      to_address: "0xabc",
      amount: "0.1",
      idempotency_key: "key-1",
    });
  });

  it("does not mutate the stored plan", () => {
    const p = plan();
    broadcastArgs(p, "key-1");
    expect(p.args.simulate).toBe(true);
  });
});
