/**
 * The pending-plan store: the mechanism that makes execution deterministic.
 *
 * A plan records the EXACT argument object that was dry run. Confirming
 * replays that object verbatim -- `simulate` dropped, a fresh idempotency
 * key added -- so the model never contributes to the broadcast path. Any
 * design that re-derives arguments on approval puts the language model back
 * in the loop at the one moment the human already signed off on something
 * specific, which is precisely the reinterpretation this plugin removes.
 */

export type PendingPlan = {
  /** KeeperHub MCP tool the plan was simulated against. */
  tool: string;
  /** Verbatim arguments passed to the simulate call, `simulate: true` included. */
  args: Record<string, unknown>;
  /** Rendered summary the human actually reviewed. */
  summary: string;
  createdAt: number;
};

/**
 * How long an approved plan stays executable. Gas, balances and prices move;
 * a plan approved long after it was priced is no longer the plan that was
 * reviewed, so it expires rather than silently executing against new state.
 */
export const PLAN_TTL_MS = 10 * 60 * 1000;

export type PlanStore = {
  put(roomId: string, plan: PendingPlan): void;
  take(roomId: string, now?: number): PendingPlan | undefined;
  peek(roomId: string, now?: number): PendingPlan | undefined;
  clear(roomId: string): void;
};

/**
 * ponytail: in-memory, per-process. A restart between simulate and confirm
 * loses the plan and the human re-runs the dry run, which is the safe
 * direction to fail. Move to runtime memory if approvals need to outlive
 * the process or span agent replicas.
 */
export function createPlanStore(ttlMs: number = PLAN_TTL_MS): PlanStore {
  const plans = new Map<string, PendingPlan>();

  const fresh = (roomId: string, now: number): PendingPlan | undefined => {
    const plan = plans.get(roomId);
    if (!plan) {
      return;
    }
    if (now - plan.createdAt > ttlMs) {
      plans.delete(roomId);
      return;
    }
    return plan;
  };

  return {
    put(roomId, plan) {
      plans.set(roomId, plan);
    },
    peek(roomId, now = Date.now()) {
      return fresh(roomId, now);
    },
    take(roomId, now = Date.now()) {
      const plan = fresh(roomId, now);
      if (plan) {
        // Taken exactly once: a second approval cannot replay a broadcast.
        plans.delete(roomId);
      }
      return plan;
    },
    clear(roomId) {
      plans.delete(roomId);
    },
  };
}

/**
 * Build the broadcast arguments from a reviewed plan.
 *
 * The only permitted edits to a dry-run payload: drop `simulate` so the call
 * broadcasts, and attach an idempotency key so a retry cannot double-spend.
 * Everything else is carried through untouched.
 */
export function broadcastArgs(
  plan: PendingPlan,
  idempotencyKey: string
): Record<string, unknown> {
  const { simulate: _simulate, ...rest } = plan.args;
  return { ...rest, idempotency_key: idempotencyKey };
}
