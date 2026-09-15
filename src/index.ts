import type { IAgentRuntime, Plugin } from "@elizaos/core";
import {
  type ActionDeps,
  createConfirmAction,
  createContractCallAction,
  createSimulateAction,
} from "./actions.js";
import { KeeperHubClient, readConfig } from "./client.js";
import { createPlanStore } from "./plan.js";
import { createWalletProvider } from "./provider.js";

/**
 * KeeperHub execution layer for ElizaOS.
 *
 * The agent proposes and dry runs; a human approves; KeeperHub broadcasts the
 * reviewed plan byte for byte. The split between the two actions is the whole
 * design: KEEPERHUB_SIMULATE structurally cannot move value, and
 * KEEPERHUB_CONFIRM structurally cannot invent any.
 */

let client: KeeperHubClient | undefined;
let defaultChainId = "11155111";

const plans = createPlanStore();

const deps: ActionDeps = {
  getClient: () => client,
  plans,
  defaultChainId: () => defaultChainId,
};

export const keeperhubPlugin: Plugin = {
  name: "plugin-keeperhub",
  description:
    "Deterministic onchain execution for ElizaOS agents via KeeperHub: compose, dry run, human approval, exact execution.",

  init: (_config: Record<string, string>, runtime: IAgentRuntime) => {
    const config = readConfig((key) => runtime.getSetting(key));
    if (!config) {
      // Absent configuration is not fatal. The provider tells the agent that
      // execution is unavailable and the actions refuse; an agent that also
      // does other things keeps working.
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
    createConfirmAction(deps),
  ],
  providers: [createWalletProvider(() => client)],
};

export default keeperhubPlugin;

export { KeeperHubClient, readConfig } from "./client.js";
export { broadcastArgs, createPlanStore, PLAN_TTL_MS } from "./plan.js";
export type { PendingPlan, PlanStore } from "./plan.js";
export {
  contractCallIntentSchema,
  parseContractCallIntent,
  parseTransferIntent,
  transferIntentSchema,
} from "./extract.js";
export type { ContractCallIntent, TransferIntent } from "./extract.js";
