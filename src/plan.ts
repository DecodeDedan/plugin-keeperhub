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
  /**
   * Stable name for this piece of work, minted once when the plan is queued.
   *
   * The idempotency key is derived from it, so every broadcast of this one
   * plan sends the same key and a retry replays rather than re-executing. A
   * fresh dry run mints a new one, so two deliberate identical transfers stay
   * distinct inside the 24-hour replay window.
   */
  taskId: string;
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

/** Mint a task id for a new plan. Callers should not reuse one across plans. */
export function newTaskId(): string {
  return crypto.randomUUID();
}

/**
 * The last execution started in a room.
 *
 * A broadcast that comes back `unconfirmed` or `running` is not finished, and
 * the correct response to that is to poll, never to re-send. Remembering the
 * execution id is what lets the agent answer "did it land" without the human
 * copying an identifier out of a chat message.
 */
export type ExecutionTracker = {
  put(roomId: string, executionId: string): void;
  get(roomId: string): string | undefined;
};

export function createExecutionTracker(): ExecutionTracker {
  const executions = new Map<string, string>();
  return {
    put(roomId, executionId) {
      executions.set(roomId, executionId);
    },
    get(roomId) {
      return executions.get(roomId);
    },
  };
}
