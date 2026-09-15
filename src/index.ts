import type { IAgentRuntime, Plugin } from "@elizaos/core";
import {
  type ActionDeps,
  createCheckAndExecuteAction,
  createConfirmAction,
  createContractCallAction,
  createSimulateAction,
  createStatusAction,
} from "./actions.js";
import { KeeperHubClient, readConfig } from "./client.js";
import { createExecutionMemoryEvaluator } from "./evaluator.js";
import { createExecutionTracker, createPlanStore } from "./plan.js";
import { createWalletProvider } from "./provider.js";

/**
 * KeeperHub execution layer for ElizaOS.
 *
 * The agent proposes and dry runs; a human approves; KeeperHub broadcasts the
 * reviewed plan byte for byte. The split between the simulate actions and the
 * confirm action is the whole design: a simulate action structurally cannot
 * move value, and the confirm action structurally cannot invent any.
 */

let client: KeeperHubClient | undefined;
let defaultChainId = "11155111";

const plans = createPlanStore();
const executions = createExecutionTracker();

const deps: ActionDeps = {
  getClient: () => client,
  plans,
  executions,
  defaultChainId: () => defaultChainId,
};

export const keeperhubPlugin: Plugin = {
  name: "plugin-keeperhub",
  description:
    "Deterministic onchain execution for ElizaOS agents via KeeperHub: compose, dry run, human approval, exact execution.",

  init: (_config: Record<string, string>, runtime: IAgentRuntime) => {
    const config = readConfig((key) => runtime.getSetting(key));
    if (!config) {
      // Absent configuration is not fatal. The provider reports that execution
      // is unavailable and every action refuses, so an agent that also does
      // other things keeps working.
      client = undefined;
      return Promise.resolve();
    }
    defaultChainId = config.defaultChainId;
    client = new KeeperHubClient(config);
    return Promise.resolve();
  },

  actions: [
    createSimulateAction(deps),
    createContractCallAction(deps),
    createCheckAndExecuteAction(deps),
    createConfirmAction(deps),
    createStatusAction(deps),
  ],
  providers: [createWalletProvider(() => client)],
  evaluators: [createExecutionMemoryEvaluator(executions)],
};

export default keeperhubPlugin;

export { KeeperHubClient, readConfig } from "./client.js";
export type { KeeperHubConfig, ToolResult } from "./client.js";
export {
  broadcastArgs,
  createExecutionTracker,
  createPlanStore,
  newTaskId,
  PLAN_TTL_MS,
} from "./plan.js";
export {
  canonicalizeAddress,
  canonicalizeAmount,
  canonicalizeChainId,
  canonicalizeTaskId,
  CanonicalizationError,
  canonicalString,
  deriveIdempotencyKey,
} from "./idempotency.js";
export type { ExecutionTracker, PendingPlan, PlanStore } from "./plan.js";
export {
  checkAndExecuteIntentSchema,
  contractCallIntentSchema,
  parseCheckAndExecuteIntent,
  parseContractCallIntent,
  parseTransferIntent,
  transferIntentSchema,
} from "./extract.js";
export type {
  CheckAndExecuteIntent,
  ContractCallIntent,
  TransferIntent,
} from "./extract.js";
export {
  isSolanaChainId,
  isTerminal,
  parseConditionOutcome,
  parseExecuteResponse,
  parseExecutionStatus,
  parseIntegrations,
  parseKeeperHubError,
  parseReadResult,
  parseReceipts,
  parseSimulateResult,
  parseSpendCap,
  recoverErrorBody,
} from "./keeperhub-types.js";
export type {
  ConditionOutcome,
  ExecuteResponse,
  ExecutionStatus,
  ExecutionStatusResponse,
  IntegrationSummary,
  KeeperHubError,
  ReadResult,
  ReceiptEntry,
  SimulateFailure,
  SimulateResult,
  SimulateSuccess,
  SpendCapData,
} from "./keeperhub-types.js";
export {
  formatValue,
  formatWei,
  renderConditionNotMet,
  renderExecuteResponse,
  renderExecutionStatus,
  renderReadResult,
  renderReceipts,
  renderSimulateFailure,
  renderSimulateSuccess,
  renderSpendCap,
  subtractWei,
} from "./render.js";
