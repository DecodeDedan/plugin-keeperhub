import type { Evaluator, IAgentRuntime, Memory, State } from "@elizaos/core";
import type { ExecutionTracker } from "./plan.js";

/**
 * Records what the agent actually executed, so later turns can reason about
 * it.
 *
 * ElizaOS evaluators run after a response, which is the right place for this:
 * the agent should remember that it moved value, and be able to answer "what
 * did you do" without the human re-reading scrollback. It records the
 * execution identifier and the room, never amounts or addresses beyond what
 * the action already reported, and it never re-reads the chain -- that is
 * KEEPERHUB_STATUS's job.
 */
export function createExecutionMemoryEvaluator(
  executions: ExecutionTracker
): Evaluator {
  return {
    name: "KEEPERHUB_RECORD_EXECUTION",
    similes: ["REMEMBER_EXECUTION"],
    description:
      "Record a KeeperHub execution started in this conversation so the agent can refer to it later.",
    alwaysRun: false,

    validate: (_runtime: IAgentRuntime, message: Memory): Promise<boolean> =>
      Promise.resolve(executions.get(message.roomId) !== undefined),

    handler: async (
      runtime: IAgentRuntime,
      message: Memory,
      _state?: State
    ) => {
      const executionId = executions.get(message.roomId);
      if (!executionId) {
        return { success: false, text: "no execution to record" };
      }

      const text = `KeeperHub execution ${executionId} was started in this conversation.`;
      await runtime.createMemory(
        {
          entityId: message.entityId,
          agentId: message.agentId,
          roomId: message.roomId,
          content: { text, source: "plugin-keeperhub" },
          createdAt: Date.now(),
        },
        "facts"
      );

      return { success: true, text, data: { executionId } };
    },

    examples: [],
  };
}
