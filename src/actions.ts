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
  CHECK_AND_EXECUTE_PROMPT,
  CONTRACT_CALL_PROMPT,
  EXTRACTION_PROMPT,
  parseCheckAndExecuteIntent,
  parseContractCallIntent,
  parseTransferIntent,
} from "./extract.js";
import { deriveIdempotencyKey } from "./idempotency.js";
import {
  ERROR_IDEMPOTENCY_CONFLICT,
  ERROR_IDEMPOTENCY_IN_PROGRESS,
  ERROR_INSUFFICIENT_SCOPE,
  isSolanaChainId,
  parseConditionOutcome,
  parseExecuteResponse,
  parseExecutionStatus,
  parseKeeperHubError,
  parseReadResult,
  parseSimulateResult,
  recoverErrorBody,
} from "./keeperhub-types.js";
import {
  broadcastArgs,
  type ExecutionTracker,
  newTaskId,
  type PendingPlan,
  type PlanStore,
} from "./plan.js";
import {
  renderConditionNotMet,
  renderExecuteResponse,
  renderExecutionStatus,
  renderReadResult,
  renderSimulateFailure,
  renderSimulateSuccess,
} from "./render.js";

const TRANSFER_TOOL = "execute_transfer";
const CONTRACT_CALL_TOOL = "execute_contract_call";
const CHECK_AND_EXECUTE_TOOL = "execute_check_and_execute";
const STATUS_TOOL = "get_direct_execution_status";

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

const VALUE_INTENT = /\b(send|transfer|pay|move|withdraw)\b/i;
const CALL_INTENT = /\b(call|invoke|approve|mint|stake|swap|deposit|contract)\b/i;
const CONDITIONAL_INTENT = /\b(if|when|once|whenever|only if|provided)\b/i;
const STATUS_INTENT =
  /\b(status|did it (land|go through|work)|confirmed|receipt|what happened|check (on )?(it|that|the tx))\b/i;

export type ActionDeps = {
  getClient: () => KeeperHubClient | undefined;
  plans: PlanStore;
  executions: ExecutionTracker;
  defaultChainId: () => string;
};

// ---------------------------------------------------------------------------
// Transfer
// ---------------------------------------------------------------------------

export function createSimulateAction(deps: ActionDeps): Action {
  return {
    name: "KEEPERHUB_SIMULATE",
    similes: ["DRY_RUN_TRANSFER", "PREVIEW_TRANSFER", "PROPOSE_TRANSFER"],
    description:
      "Dry run a token transfer through KeeperHub without touching the chain, and present the plan for human approval. Use this for every request to send, transfer or pay funds. It never moves value.",

    validate: (_runtime, message) =>
      Promise.resolve(
        deps.getClient() !== undefined &&
          VALUE_INTENT.test(message.content?.text ?? "")
      ),

    handler: async (runtime, message, _state, _options, callback) => {
      const client = deps.getClient();
      if (!client) {
        return await refuse(callback, "KeeperHub is not configured, so I cannot prepare a transfer.");
      }

      const extracted = parseTransferIntent(
        await extract(runtime, EXTRACTION_PROMPT, message)
      );
      if (!extracted.ok) {
        return await refuse(
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
        {
          name: "{{user}}",
          content: { text: "send 0.05 ETH to 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" },
        },
        {
          name: "{{agent}}",
          content: {
            text: "Dry run complete, nothing has moved. Reply \"confirm\" to execute exactly this.",
            actions: ["KEEPERHUB_SIMULATE"],
          },
        },
      ],
      [
        {
          name: "{{user}}",
          content: {
            text: "pay 25 USDC to 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238 on Base",
          },
        },
        {
          name: "{{agent}}",
          content: {
            text: "Dry run complete for the token transfer. Reply \"confirm\" to execute exactly this.",
            actions: ["KEEPERHUB_SIMULATE"],
          },
        },
      ],
      [
        {
          name: "{{user}}",
          content: { text: "move some funds to my other wallet" },
        },
        {
          name: "{{agent}}",
          content: {
            text: "I could not read a complete transfer from that. Tell me the recipient address and the amount.",
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
      "Dry run a smart contract function call through KeeperHub without touching the chain, and present the plan for human approval. Use this for any request to call, invoke, approve, mint, stake, swap or deposit against a contract. It never moves value.",

    validate: (_runtime, message) => {
      const text = message.content?.text ?? "";
      return Promise.resolve(
        deps.getClient() !== undefined &&
          CALL_INTENT.test(text) &&
          !CONDITIONAL_INTENT.test(text)
      );
    },

    handler: async (runtime, message, _state, _options, callback) => {
      const client = deps.getClient();
      if (!client) {
        return await refuse(callback, "KeeperHub is not configured, so I cannot prepare a call.");
      }

      const extracted = parseContractCallIntent(
        await extract(runtime, CONTRACT_CALL_PROMPT, message)
      );
      if (!extracted.ok) {
        return await refuse(
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
            text: "call approve on 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238 for spender 0xAbC7B196Cb0C7B01d743Fbc6116a902379C72381 and 1000",
          },
        },
        {
          name: "{{agent}}",
          content: {
            text: "Dry run complete, nothing has moved. Reply \"confirm\" to execute exactly this.",
            actions: ["KEEPERHUB_SIMULATE_CALL"],
          },
        },
      ],
      [
        {
          name: "{{user}}",
          content: { text: "stake 2 ETH by calling deposit on 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" },
        },
        {
          name: "{{agent}}",
          content: {
            text: "Dry run complete for the payable call. Reply \"confirm\" to execute exactly this.",
            actions: ["KEEPERHUB_SIMULATE_CALL"],
          },
        },
      ],
    ],
  };
}

// ---------------------------------------------------------------------------
// Conditional execution
// ---------------------------------------------------------------------------

export function createCheckAndExecuteAction(deps: ActionDeps): Action {
  return {
    name: "KEEPERHUB_SIMULATE_CONDITIONAL",
    similes: ["DRY_RUN_CHECK_AND_EXECUTE", "PREVIEW_CONDITIONAL", "PROPOSE_CONDITIONAL"],
    description:
      "Dry run a conditional onchain action through KeeperHub: read one value from a contract and call a function only if a comparison holds. Use this when the request is phrased as a condition, such as 'if the balance is above X, then transfer'. It never moves value.",

    validate: (_runtime, message) => {
      const text = message.content?.text ?? "";
      return Promise.resolve(
        deps.getClient() !== undefined &&
          CONDITIONAL_INTENT.test(text) &&
          (CALL_INTENT.test(text) || VALUE_INTENT.test(text))
      );
    },

    handler: async (runtime, message, _state, _options, callback) => {
      const client = deps.getClient();
      if (!client) {
        return await refuse(
          callback,
          "KeeperHub is not configured, so I cannot prepare a conditional action."
        );
      }

      const extracted = parseCheckAndExecuteIntent(
        await extract(runtime, CHECK_AND_EXECUTE_PROMPT, message)
      );
      if (!extracted.ok) {
        return await refuse(
          callback,
          `I could not read a complete conditional action from that (${extracted.reason}). Tell me what to read, what to compare it against, and what to do if it holds.`
        );
      }

      const { intent } = extracted;
      const action: Record<string, unknown> = {
        contract_address: intent.action.contract_address,
        function_name: intent.action.function_name,
      };
      if (intent.action.function_args !== undefined) {
        action.function_args = intent.action.function_args;
      }

      const args: Record<string, unknown> = {
        chain_id: intent.chain_id ?? deps.defaultChainId(),
        contract_address: intent.contract_address,
        function_name: intent.function_name,
        condition: intent.condition,
        action,
        simulate: true,
      };
      if (intent.function_args !== undefined) {
        args.function_args = intent.function_args;
      }

      return await dryRunAndQueue(deps, client, CHECK_AND_EXECUTE_TOOL, args, message, callback);
    },

    examples: [
      [
        {
          name: "{{user}}",
          content: {
            text: "if balanceOf 0xAbC7B196Cb0C7B01d743Fbc6116a902379C72381 on 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238 is above 1000, transfer 1000 to 0xAbC7B196Cb0C7B01d743Fbc6116a902379C72381",
          },
        },
        {
          name: "{{agent}}",
          content: {
            text: "Dry run complete for the conditional action, nothing has moved. Reply \"confirm\" to execute exactly this.",
            actions: ["KEEPERHUB_SIMULATE_CONDITIONAL"],
          },
        },
      ],
    ],
  };
}

// ---------------------------------------------------------------------------
// Shared dry-run path
// ---------------------------------------------------------------------------

/**
 * Dry run a payload, refuse anything that is not a clean pass, and queue what
 * survives for human approval.
 *
 * Shared by every simulate action so the rule that matters cannot drift: a
 * plan reaches the store only when KeeperHub returned an unambiguous success.
 * A revert, a validation failure and an unreachable simulator are three
 * different events and are reported as such, but none of them queues anything.
 */
async function dryRunAndQueue(
  deps: ActionDeps,
  client: KeeperHubClient,
  tool: string,
  args: Record<string, unknown>,
  message: Memory,
  callback: HandlerCallback | undefined
): Promise<ActionResult> {
  // Simulation is EVM-only. Without this guard a Solana request reaches the
  // MCP layer and is rejected there with a chain error, which reads as a bug
  // rather than as the deliberate limitation it is. This plugin's whole
  // design depends on a dry run, so it declines rather than broadcasting one
  // that was never previewed.
  const chainId = String(args.chain_id ?? "");
  if (isSolanaChainId(chainId)) {
    deps.plans.clear(message.roomId);
    return await refuse(
      callback,
      `Chain ${chainId} is Solana, and KeeperHub's dry run is EVM-only. I will not broadcast something I could not preview, so this needs an EVM chain or a Solana-aware preflight outside this plugin.`
    );
  }

  const response = await client.callTool(tool, args);

  if (!response.ok) {
    deps.plans.clear(message.roomId);
    // A revert or an invalid simulation arrives as a tool error, not as a
    // successful response carrying success: false, and the body is embedded
    // in a longer message rather than being the parsed payload. Recover it
    // before parsing, or the rich reason (shortfall, revert reason) is lost
    // and the user gets a bare status line instead.
    const body = recoverErrorBody(response.data, response.error);
    const failure = parseSimulateResult(body);
    if (failure && !failure.success) {
      return await refuse(callback, `${renderSimulateFailure(failure)}\n\nNothing is queued.`);
    }
    const detail = parseKeeperHubError(body, response.error);
    const reason = detail?.message ?? detail?.error ?? response.error;
    const hint = detail?.hint ? `\n  hint         ${detail.hint}` : "";
    return await refuse(
      callback,
      `The dry run did not pass, so nothing is queued.\n  reason       ${reason}${hint}`
    );
  }

  // A view or pure call, and a check whose condition does not hold, answer
  // with their normal result instead of a simulation envelope. Neither would
  // broadcast anything, so both are reported and nothing is queued.
  const read = parseReadResult(response.data);
  if (read) {
    deps.plans.clear(message.roomId);
    const text = renderReadResult(read);
    await callback?.({ text, actions: [tool] });
    return { success: true, text, data: { read } };
  }

  const condition = parseConditionOutcome(response.data);
  if (condition && !condition.conditionResult.met) {
    deps.plans.clear(message.roomId);
    const text = renderConditionNotMet(condition);
    await callback?.({ text, actions: [tool] });
    return { success: true, text, data: { condition } };
  }

  const simulation = parseSimulateResult(response.data);
  if (!simulation) {
    deps.plans.clear(message.roomId);
    return await refuse(
      callback,
      "KeeperHub answered the dry run in a shape I do not recognise, so I will not queue anything from it."
    );
  }

  if (!simulation.success) {
    deps.plans.clear(message.roomId);
    return await refuse(callback, `${renderSimulateFailure(simulation)}\n\nNothing is queued.`);
  }

  const summary = [renderPlan(tool, args), ...renderSimulateSuccess(simulation)].join("\n");
  deps.plans.put(message.roomId, {
    tool,
    args,
    summary,
    taskId: newTaskId(),
    createdAt: Date.now(),
  });

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
      "Broadcast the plan that was already dry run and shown to the user, exactly as reviewed. Only valid immediately after a KeeperHub dry run and only when the user explicitly approved.",

    validate: (_runtime, message) =>
      Promise.resolve(
        deps.getClient() !== undefined &&
          deps.plans.peek(message.roomId) !== undefined &&
          AFFIRMATION.test(message.content?.text ?? "")
      ),

    handler: async (_runtime, message, _state, _options, callback) => {
      const client = deps.getClient();
      if (!client) {
        return await refuse(callback, "KeeperHub is not configured, so I cannot execute.");
      }

      // take() removes the plan before the call, so a duplicate approval
      // arriving while this one is in flight finds nothing to broadcast.
      const plan = deps.plans.take(message.roomId);
      if (!plan) {
        return await refuse(
          callback,
          "There is no reviewed plan waiting. Ask me for the action again and I will dry run it first."
        );
      }

      // Derived from the plan, not generated per attempt. A per-attempt UUID
      // does not survive a retry: the second attempt sends a different key,
      // the request is treated as new, and the transfer executes twice.
      const idempotencyKey = deriveIdempotencyKey(plan.taskId, plan.tool, plan.args);
      const response = await client.callTool(
        plan.tool,
        broadcastArgs(plan, idempotencyKey)
      );

      if (!response.ok) {
        return await handleBroadcastError(deps, plan, message, callback, response.error, response.data);
      }

      const receipt = parseExecuteResponse(response.data);
      if (!receipt) {
        // No definite outcome, so the plan is kept: a retry must be able to
        // derive the same key, and rotating after an ambiguous result is what
        // turns one intent into two transactions.
        deps.plans.put(message.roomId, plan);
        const text =
          "KeeperHub accepted the call but answered in a shape I do not recognise. I have kept the plan so a retry reuses the same idempotency key. Ask me to check the status rather than starting over.";
        await callback?.({ text, actions: ["KEEPERHUB_CONFIRM"] });
        return { success: false, text, error: text };
      }

      deps.executions.put(message.roomId, receipt.executionId);
      const text = renderExecuteResponse(receipt);
      await callback?.({ text, actions: ["KEEPERHUB_CONFIRM"] });

      // Only a settled failure is reported as failure. `unconfirmed`,
      // `pending` and `running` are in flight, and calling them failures is
      // what provokes a retry of a transfer that may already have landed.
      return {
        success: receipt.status !== "failed",
        text,
        data: { receipt, idempotencyKey },
        ...(receipt.status === "failed" && receipt.error ? { error: receipt.error } : {}),
      };
    },

    examples: [
      [
        { name: "{{user}}", content: { text: "confirm" } },
        {
          name: "{{agent}}",
          content: {
            text: "Executed the plan you approved. The chain confirmed it.",
            actions: ["KEEPERHUB_CONFIRM"],
          },
        },
      ],
      [
        { name: "{{user}}", content: { text: "yes, go ahead" } },
        {
          name: "{{agent}}",
          content: {
            text: "Broadcast. The transaction is on chain but not yet confirmed, so this is not final yet.",
            actions: ["KEEPERHUB_CONFIRM"],
          },
        },
      ],
    ],
  };
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export function createStatusAction(deps: ActionDeps): Action {
  return {
    name: "KEEPERHUB_STATUS",
    similes: ["CHECK_EXECUTION", "EXECUTION_STATUS", "DID_IT_LAND"],
    description:
      "Check whether a previously broadcast KeeperHub execution has settled. Use this instead of re-sending whenever an execution came back unconfirmed, pending or running.",

    validate: (_runtime, message) =>
      Promise.resolve(
        deps.getClient() !== undefined &&
          deps.executions.get(message.roomId) !== undefined &&
          STATUS_INTENT.test(message.content?.text ?? "")
      ),

    handler: async (_runtime, message, _state, _options, callback) => {
      const client = deps.getClient();
      if (!client) {
        return await refuse(callback, "KeeperHub is not configured, so I cannot check a status.");
      }

      const executionId = deps.executions.get(message.roomId);
      if (!executionId) {
        return await refuse(
          callback,
          "I have no execution from this conversation to check."
        );
      }

      const response = await client.callTool(STATUS_TOOL, { execution_id: executionId });
      if (!response.ok) {
        return await refuse(callback, `I could not read that execution's status: ${response.error}`);
      }

      const status = parseExecutionStatus(response.data);
      if (!status) {
        return await refuse(
          callback,
          "KeeperHub answered the status request in a shape I do not recognise."
        );
      }

      const text = renderExecutionStatus(status);
      await callback?.({ text, actions: ["KEEPERHUB_STATUS"] });
      return { success: true, text, data: { status } };
    },

    examples: [
      [
        { name: "{{user}}", content: { text: "did it land?" } },
        {
          name: "{{agent}}",
          content: {
            text: "Execution abc123 is completed.",
            actions: ["KEEPERHUB_STATUS"],
          },
        },
      ],
    ],
  };
}

// ---------------------------------------------------------------------------
// Broadcast failure handling
// ---------------------------------------------------------------------------

/**
 * Decide what a failed broadcast means for the plan.
 *
 * The question that matters is whether a definite outcome is known. When it
 * is, the plan is finished with and a later attempt is different work. When it
 * is not -- a timeout, a dropped connection, a 5xx -- the plan is put back, so
 * a retry derives the same idempotency key and replays instead of sending a
 * second transaction.
 */
async function handleBroadcastError(
  deps: ActionDeps,
  plan: PendingPlan,
  message: Memory,
  callback: HandlerCallback | undefined,
  errorText: string,
  errorData: unknown
): Promise<ActionResult> {
  const detail = parseKeeperHubError(errorData, errorText);
  const reason = detail?.message ?? detail?.error ?? errorText;

  if (detail?.code === ERROR_IDEMPOTENCY_IN_PROGRESS) {
    // Definite and benign: the first attempt is still running. Keep the plan
    // so the retry sends the same key, which is what the guard expects.
    deps.plans.put(message.roomId, plan);
    const text = `That execution is already in progress under the same key. Nothing was sent twice. Ask me to confirm again shortly, or to check the status.\n  reason       ${reason}`;
    await callback?.({ text, actions: ["KEEPERHUB_CONFIRM"] });
    return { success: false, text, error: reason };
  }

  if (detail?.code === ERROR_IDEMPOTENCY_CONFLICT) {
    // Definite: this key already named different work. Retrying cannot help.
    const original = detail.originalExecutionId;
    if (original) {
      deps.executions.put(message.roomId, original);
    }
    const text = `That idempotency key was already used for a different request, so nothing was sent.${
      original ? ` The key first produced execution ${original}.` : ""
    } Ask me for a fresh dry run.`;
    await callback?.({ text, actions: ["KEEPERHUB_CONFIRM"] });
    return { success: false, text, error: reason };
  }

  if (detail?.code === ERROR_INSUFFICIENT_SCOPE) {
    const text = `This API key may simulate but not broadcast. Nothing was sent. Use a key with mcp:write or mcp:admin scope.\n  reason       ${reason}`;
    await callback?.({ text, actions: ["KEEPERHUB_CONFIRM"] });
    return { success: false, text, error: reason };
  }

  // No definite outcome. Keep the plan so a retry reuses the same key.
  deps.plans.put(message.roomId, plan);
  const text = `The execution call failed without a definite outcome, so it is not known whether it reached the chain: ${reason}\n\nI have kept the plan, so confirming again reuses the same idempotency key and cannot send a second transaction. Ask me to check the status first.`;
  await callback?.({ text, actions: ["KEEPERHUB_CONFIRM"] });
  return { success: false, text, error: reason };
}

// ---------------------------------------------------------------------------
// Rendering and helpers
// ---------------------------------------------------------------------------

export function renderPlan(tool: string, args: Record<string, unknown>): string {
  const lines = ["Dry run complete. This is the exact plan that would execute:"];

  if (tool === TRANSFER_TOOL) {
    const asset = args.token_address
      ? `token ${String(args.token_address)}`
      : "native token";
    lines.push(
      `  move         ${String(args.amount)} (${asset})`,
      `  to           ${String(args.to_address)}`
    );
  } else if (tool === CHECK_AND_EXECUTE_TOOL) {
    const condition = args.condition as
      | { operator?: unknown; value?: unknown }
      | undefined;
    const action = args.action as
      | { contract_address?: unknown; function_name?: unknown; function_args?: unknown }
      | undefined;
    lines.push(
      `  read         ${String(args.function_name)} on ${String(args.contract_address)}`
    );
    if (args.function_args !== undefined) {
      lines.push(`  read args    ${String(args.function_args)}`);
    }
    lines.push(
      `  condition    result ${String(condition?.operator)} ${String(condition?.value)}`,
      `  then call    ${String(action?.function_name)} on ${String(action?.contract_address)}`
    );
    if (action?.function_args !== undefined) {
      lines.push(`  call args    ${String(action.function_args)}`);
    }
  } else {
    lines.push(
      `  call         ${String(args.function_name)}`,
      `  on           ${String(args.contract_address)}`
    );
    if (args.function_args !== undefined) {
      lines.push(`  args         ${String(args.function_args)}`);
    }
    if (args.value !== undefined) {
      lines.push(`  value        ${String(args.value)}`);
    }
  }

  lines.push(`  chain        ${String(args.chain_id)}`);
  return lines.join("\n");
}

async function extract(
  runtime: IAgentRuntime,
  prompt: string,
  message: Memory
): Promise<unknown> {
  return await runtime.useModel(ModelType.TEXT_LARGE, {
    prompt: `${prompt}\n\nUser message:\n${message.content?.text ?? ""}`,
  });
}

async function refuse(
  callback: HandlerCallback | undefined,
  text: string
): Promise<ActionResult> {
  await callback?.({ text });
  return { success: false, text, error: text };
}

export type { State };
