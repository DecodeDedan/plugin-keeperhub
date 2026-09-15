import {
  type Action,
  type ActionResult,
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  ModelType,
  type State,
} from "@elizaos/core";
import type { KeeperHubClient } from "./client.js";
import {
  CONTRACT_CALL_PROMPT,
  EXTRACTION_PROMPT,
  parseContractCallIntent,
  parseTransferIntent,
} from "./extract.js";
import { broadcastArgs, type PlanStore } from "./plan.js";

const TRANSFER_TOOL = "execute_transfer";
const CONTRACT_CALL_TOOL = "execute_contract_call";

/**
 * Words that count as approval. Action selection is driven by a language
 * model, so this is the second lock: even if the model routes an ambiguous
 * message to the confirm action, nothing broadcasts unless the human wrote
 * something unmistakably affirmative. Matching is deliberately narrow --
 * failing to recognise an approval costs one repeated word, failing to
 * recognise its absence costs real money.
 */
const AFFIRMATION =
  /^\s*(yes|y|confirm(ed)?|approve[d]?|do it|send it|execute|go ahead|ship it|lgtm)\b/i;

/** Cheap signal that a message might be about moving value, for validate(). */
const VALUE_INTENT = /\b(send|transfer|pay|move|withdraw)\b/i;
/** Cheap signal that a message names a contract interaction. */
const CALL_INTENT = /\b(call|invoke|execute|approve|mint|stake|swap|deposit|contract)\b/i;

export type ActionDeps = {
  getClient: () => KeeperHubClient | undefined;
  plans: PlanStore;
  defaultChainId: () => string;
};

// ---------------------------------------------------------------------------
// Simulate
// ---------------------------------------------------------------------------

export function createSimulateAction(deps: ActionDeps): Action {
  return {
    name: "KEEPERHUB_SIMULATE",
    similes: ["DRY_RUN_TRANSFER", "PREVIEW_TRANSFER", "PROPOSE_TRANSFER"],
    description:
      "Dry run a token transfer through KeeperHub without touching the chain, and present the plan for human approval. Use this for every request to send, transfer or pay funds. It never moves value.",

    validate: (_runtime, message) => {
      const text = message.content?.text ?? "";
      return Promise.resolve(
        deps.getClient() !== undefined && VALUE_INTENT.test(text)
      );
    },

    handler: async (
      runtime: IAgentRuntime,
      message: Memory,
      _state?: State,
      _options?: unknown,
      callback?: HandlerCallback
    ): Promise<ActionResult> => {
      const client = deps.getClient();
      if (!client) {
        return await fail(callback, "KeeperHub is not configured, so I cannot prepare a transfer.");
      }

      const raw = await runtime.useModel(ModelType.TEXT_LARGE, {
        prompt: `${EXTRACTION_PROMPT}\n\nUser message:\n${message.content?.text ?? ""}`,
      });

      const extracted = parseTransferIntent(raw);
      if (!extracted.ok) {
        return await fail(
          callback,
          `I could not read a complete transfer from that (${extracted.reason}). Tell me the recipient address and the amount.`
        );
      }

      const args: Record<string, unknown> = {
        chain_id: extracted.intent.chain_id ?? deps.defaultChainId(),
        to_address: extracted.intent.to_address,
        amount: extracted.intent.amount,
        simulate: true,
      };
      if (extracted.intent.token_address) {
        args.token_address = extracted.intent.token_address;
      }

      return await dryRunAndQueue(deps, client, TRANSFER_TOOL, args, message, callback);
    },

    examples: [
      [
        { name: "{{user}}", content: { text: "send 0.05 ETH to 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" } },
        {
          name: "{{agent}}",
          content: {
            text: "Dry run only, nothing has moved. Reply \"confirm\" to execute exactly this.",
            actions: ["KEEPERHUB_SIMULATE"],
          },
        },
      ],
    ],
  };
}

// ---------------------------------------------------------------------------
// Contract call
// ---------------------------------------------------------------------------

export function createContractCallAction(deps: ActionDeps): Action {
  return {
    name: "KEEPERHUB_SIMULATE_CALL",
    similes: ["DRY_RUN_CONTRACT_CALL", "PREVIEW_CONTRACT_CALL", "PROPOSE_CONTRACT_CALL"],
    description:
      "Dry run a smart contract function call through KeeperHub without touching the chain, and present the plan for human approval. Use this for any request to call, invoke or execute a contract function. It never moves value.",

    validate: (_runtime, message) => {
      const text = message.content?.text ?? "";
      return Promise.resolve(
        deps.getClient() !== undefined && CALL_INTENT.test(text)
      );
    },

    handler: async (
      runtime: IAgentRuntime,
      message: Memory,
      _state?: State,
      _options?: unknown,
      callback?: HandlerCallback
    ): Promise<ActionResult> => {
      const client = deps.getClient();
      if (!client) {
        return await fail(callback, "KeeperHub is not configured, so I cannot prepare a call.");
      }

      const raw = await runtime.useModel(ModelType.TEXT_LARGE, {
        prompt: `${CONTRACT_CALL_PROMPT}\n\nUser message:\n${message.content?.text ?? ""}`,
      });

      const extracted = parseContractCallIntent(raw);
      if (!extracted.ok) {
        return await fail(
          callback,
          `I could not read a complete contract call from that (${extracted.reason}). Tell me the contract address and the function to call.`
        );
      }

      const args: Record<string, unknown> = {
        chain_id: extracted.intent.chain_id ?? deps.defaultChainId(),
        contract_address: extracted.intent.contract_address,
        function_name: extracted.intent.function_name,
        simulate: true,
      };
      if (extracted.intent.function_args !== undefined) {
        args.function_args = extracted.intent.function_args;
      }
      if (extracted.intent.value !== undefined) {
        args.value = extracted.intent.value;
      }

      return await dryRunAndQueue(deps, client, CONTRACT_CALL_TOOL, args, message, callback);
    },

    examples: [
      [
        {
          name: "{{user}}",
          content: {
            text: "call approve on 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238 with 0xSpender and 1000",
          },
        },
        {
          name: "{{agent}}",
          content: {
            text: "Dry run only, nothing has moved. Reply \"confirm\" to execute exactly this.",
            actions: ["KEEPERHUB_SIMULATE_CALL"],
          },
        },
      ],
    ],
  };
}

/**
 * Dry run a payload, refuse anything that would revert, and queue what
 * survives for human approval. Shared by both simulate actions so the two
 * paths cannot drift on the rule that matters: nothing reaches the plan store
 * unless KeeperHub said it would succeed.
 */
async function dryRunAndQueue(
  deps: ActionDeps,
  client: KeeperHubClient,
  tool: string,
  args: Record<string, unknown>,
  message: Memory,
  callback: HandlerCallback | undefined
): Promise<ActionResult> {
  const result = await client.callTool(tool, args);
  if (!result.ok) {
    deps.plans.clear(message.roomId);
    return await fail(callback, `The dry run failed, so nothing is pending: ${result.error}`);
  }

  const simulation = result.data as Record<string, unknown> | undefined;
  if (wouldRevert(simulation)) {
    deps.plans.clear(message.roomId);
    return await fail(
      callback,
      `The dry run says this would revert onchain, so I have not queued it.\n\n${describe(simulation)}`
    );
  }

  const summary = renderPlan(tool, args, simulation);
  deps.plans.put(message.roomId, { tool, args, summary, createdAt: Date.now() });

  const text = `${summary}\n\nNothing has moved. Reply "confirm" to execute exactly this, or ignore it to discard.`;
  await callback?.({ text, actions: [tool] });
  return { success: true, text, data: { simulation, args } };
}

// ---------------------------------------------------------------------------
// Confirm
// ---------------------------------------------------------------------------

export function createConfirmAction(deps: ActionDeps): Action {
  return {
    name: "KEEPERHUB_CONFIRM",
    similes: ["APPROVE_TRANSFER", "EXECUTE_PENDING", "BROADCAST_TRANSFER"],
    description:
      "Broadcast the transfer that was already dry run and shown to the user, exactly as reviewed. Only valid immediately after KEEPERHUB_SIMULATE and only when the user explicitly approved.",

    validate: (_runtime, message) => {
      const text = message.content?.text ?? "";
      return Promise.resolve(
        deps.getClient() !== undefined &&
          deps.plans.peek(message.roomId) !== undefined &&
          AFFIRMATION.test(text)
      );
    },

    handler: async (
      _runtime: IAgentRuntime,
      message: Memory,
      _state?: State,
      _options?: unknown,
      callback?: HandlerCallback
    ): Promise<ActionResult> => {
      const client = deps.getClient();
      if (!client) {
        return await fail(callback, "KeeperHub is not configured, so I cannot execute.");
      }

      // take() removes the plan before the call, so a duplicate approval
      // arriving while this one is in flight finds nothing to broadcast.
      const plan = deps.plans.take(message.roomId);
      if (!plan) {
        return await fail(
          callback,
          "There is no reviewed plan waiting. Ask me for the transfer again and I will dry run it first."
        );
      }

      const idempotencyKey = crypto.randomUUID();
      const result = await client.callTool(
        plan.tool,
        broadcastArgs(plan, idempotencyKey)
      );

      if (!result.ok) {
        const text = `Execution failed and no funds moved: ${result.error}\n\nThe plan has been discarded. Ask again to start a fresh dry run.`;
        await callback?.({ text, actions: ["KEEPERHUB_CONFIRM"] });
        return { success: false, text, error: result.error };
      }

      const receipt = result.data as Record<string, unknown> | undefined;
      const text = `Executed the plan you approved.\n\n${describe(receipt)}`;
      await callback?.({ text, actions: ["KEEPERHUB_CONFIRM"] });
      return { success: true, text, data: { receipt, idempotencyKey } };
    },

    examples: [
      [
        { name: "{{user}}", content: { text: "confirm" } },
        {
          name: "{{agent}}",
          content: {
            text: "Executed the plan you approved.",
            actions: ["KEEPERHUB_CONFIRM"],
          },
        },
      ],
    ],
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export function renderPlan(
  tool: string,
  args: Record<string, unknown>,
  simulation: Record<string, unknown> | undefined
): string {
  const lines = ["Dry run complete. This is the exact plan that would execute:"];

  if (tool === TRANSFER_TOOL) {
    const asset = args.token_address
      ? `token ${String(args.token_address)}`
      : "native token";
    lines.push(
      `  move     ${String(args.amount)} (${asset})`,
      `  to       ${String(args.to_address)}`
    );
  } else {
    lines.push(
      `  call     ${String(args.function_name)}`,
      `  on       ${String(args.contract_address)}`
    );
    if (args.function_args !== undefined) {
      lines.push(`  args     ${String(args.function_args)}`);
    }
    if (args.value !== undefined) {
      lines.push(`  value    ${String(args.value)}`);
    }
  }
  lines.push(`  chain    ${String(args.chain_id)}`);
  const gas = simulation?.gasEstimate ?? simulation?.gasUsed ?? simulation?.gas;
  if (gas !== undefined && gas !== null) {
    lines.push(`  gas est. ${String(gas)}`);
  }
  return lines.join("\n");
}

/** True only when the simulation explicitly says it would revert. */
function wouldRevert(simulation: Record<string, unknown> | undefined): boolean {
  if (!simulation) {
    return false;
  }
  if (simulation.wouldRevert === true) {
    return true;
  }
  return simulation.success === false;
}

function describe(data: Record<string, unknown> | undefined): string {
  if (!data) {
    return "(no detail returned)";
  }
  const hash = data.transactionHash ?? data.txHash ?? data.hash;
  const link = data.explorerUrl ?? data.explorerLink;
  const parts: string[] = [];
  if (hash) {
    parts.push(`tx: ${String(hash)}`);
  }
  if (link) {
    parts.push(String(link));
  }
  if (parts.length > 0) {
    return parts.join("\n");
  }
  return JSON.stringify(data, null, 2);
}

async function fail(
  callback: HandlerCallback | undefined,
  text: string
): Promise<ActionResult> {
  await callback?.({ text });
  return { success: false, text, error: text };
}
