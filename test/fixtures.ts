import { vi } from "vitest";
import type { KeeperHubClient } from "../src/client.js";
import { createExecutionTracker, createPlanStore } from "../src/plan.js";

/**
 * Response fixtures transcribed from KeeperHub source, not from memory:
 *   simulate shapes   lib/execute/simulate.ts
 *   execute response  app/api/execute/_lib/types.ts
 *   spend cap         lib/analytics/queries.ts getSpendCapData
 *   integrations      app/api/integrations/route.ts GET
 *
 * A test that asserts against an invented shape proves nothing about the
 * running system, so these mirror the real ones field for field.
 */

export const CONTRACT = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
export const RECIPIENT = "0xAbC7B196Cb0C7B01d743Fbc6116a902379C72381";
export const WALLET = "0xDeF7B196Cb0C7B01d743Fbc6116a902379C72382";

export const simulateSuccess = {
  success: true,
  status: "simulated",
  from: WALLET,
  to: RECIPIENT,
  value: "50000000000000000",
  gasEstimate: "21000",
  simulatedReturnValue: null,
  wouldRevert: false,
} as const;

export const simulateRevert = {
  success: false,
  status: "simulated",
  from: WALLET,
  to: CONTRACT,
  value: "0",
  error: "execution reverted: ERC20: insufficient allowance",
  failureKind: "revert",
  wouldRevert: true,
  revertReason: "ERC20: insufficient allowance",
} as const;

/** The simulator could not reach the chain. Explicitly NOT a revert. */
export const simulateUnavailable = {
  success: false,
  status: "simulated",
  from: WALLET,
  to: RECIPIENT,
  value: "0",
  error: "upstream RPC timed out",
  failureKind: "unavailable",
  wouldRevert: false,
} as const;

export const simulateInsufficientBalance = {
  success: false,
  status: "simulated",
  from: WALLET,
  to: RECIPIENT,
  value: "1000000000000000000",
  error: "insufficient balance",
  failureKind: "validation",
  wouldRevert: true,
  revertReason: "insufficient balance for the requested transfer",
  code: "insufficient_balance",
  balanceWei: "250000000000000000",
  requiredWei: "1000000000000000000",
  shortfallWei: "750000000000000000",
  nativeSymbol: "ETH",
} as const;

export const executeCompleted = {
  executionId: "exec_completed_1",
  status: "completed",
  transactionHash: "0xabc123",
  transactionLink: "https://sepolia.etherscan.io/tx/0xabc123",
} as const;

export const executeUnconfirmed = {
  executionId: "exec_unconfirmed_1",
  status: "unconfirmed",
  transactionHash: "0xdef456",
  transactionLink: "https://sepolia.etherscan.io/tx/0xdef456",
} as const;

export const executeFailed = {
  executionId: "exec_failed_1",
  status: "failed",
  error: "reverted on chain",
} as const;

export const executionStatusCompleted = {
  executionId: "exec_unconfirmed_1",
  status: "completed",
  type: "transfer",
  transactionHash: "0xdef456",
  transactionLink: "https://sepolia.etherscan.io/tx/0xdef456",
  sponsored: false,
  receipts: [],
  result: null,
  error: null,
  gasUsedWei: "21000",
  gasPriceWei: "1500000000",
  estimatedCostUsd: "0.09",
  retryCount: 0,
  network: "sepolia",
  createdAt: "2026-09-16T00:00:00.000Z",
  completedAt: "2026-09-16T00:00:12.000Z",
} as const;

/** A view or pure call answers with its value, not a simulation envelope. */
export const readResult = { result: "1500000000000000000" } as const;

/** A conditional check that did not fire takes no action and says so. */
export const conditionNotMet = {
  executed: false,
  conditionResult: {
    met: false,
    observedValue: "500000000000000000",
    targetValue: "1000000000000000000",
    operator: "gt",
  },
} as const;

export const executeReplayed = {
  executionId: "exec_failed_1",
  status: "failed",
  error: "Contract call failed: Error(LK: not yet due)",
  idempotentReplay: true,
} as const;

export const executionStatusWithReceipts = {
  ...{
    executionId: "exec_unconfirmed_1",
    status: "completed",
    type: "transfer",
    transactionHash: "0xdef456",
    transactionLink: "https://sepolia.etherscan.io/tx/0xdef456",
    sponsored: false,
    result: null,
    error: null,
    gasUsedWei: "21000",
    gasPriceWei: "1500000000",
    estimatedCostUsd: "0.09",
    retryCount: 0,
    network: "sepolia",
    createdAt: "2026-09-16T00:00:00.000Z",
    completedAt: "2026-09-16T00:00:12.000Z",
  },
  receipts: [
    {
      hash: "0xdef456",
      chainId: 11155111,
      network: "sepolia",
      verified: true,
      receiptStatus: "success",
      blockNumber: 1234567,
      gasUsed: "21000",
      verifiedAt: "2026-09-16T00:00:12.000Z",
    },
  ],
} as const;

/**
 * A real production response, captured from app.keeperhub.com and reproduced
 * verbatim except that the organization wallet address is replaced with the
 * fixture one.
 *
 * Two things about it drive the parsing code, and neither was obvious from
 * the type definitions alone: a failed dry run arrives as a tool ERROR rather
 * than a success body, and the JSON is embedded in a longer human-readable
 * message rather than being the payload. Parsing `data` directly recovers
 * neither.
 */
export const liveInsufficientBalanceError = new Error(
  `API call failed: 400 Bad Request - {"success":false,"status":"simulated","from":"${WALLET.toLowerCase()}","to":"${WALLET}","value":"1000000000000","failureKind":"validation","wouldRevert":true,"revertReason":"Insufficient ETH balance. Have: 0.0, Need: 0.000001. Fund ${WALLET.toLowerCase()} with at least 0.000001 ETH on this chain and retry.","error":"Insufficient ETH balance. Have: 0.0, Need: 0.000001.","code":"insufficient_balance","balanceWei":"0","requiredWei":"1000000000000","shortfallWei":"1000000000000","nativeSymbol":"ETH","originalError":"missing revert data (action=\\"call\\", data=null, reason=null, transaction={ \\"data\\": \\"0x\\", \\"from\\": \\"${WALLET}\\", \\"to\\": \\"${WALLET}\\" }, invocation=null, revert=null, code=CALL_EXCEPTION, version=6.17.0)"}

Simulation preflight failed. Nothing was signed or broadcast.
Stage: simulation preflight - the simulator attributed a machine-readable cause.
Reason code: insufficient_balance (branch on this rather than the reason text)
Next step:
  - Fix the cause, then re-run the same arguments with simulate: true.`
);

/** KeeperHub surfaces these as MCP tool errors carrying the REST error JSON. */
export const errorInProgress = new Error(
  JSON.stringify({
    error: "A request with this Idempotency-Key is already being processed. Retry the same key shortly; do not rotate it.",
    code: "idempotency_in_progress",
    retryable: true,
  })
);

export const errorConflict = new Error(
  JSON.stringify({
    error: "A request with this Idempotency-Key already exists with a different body.",
    code: "idempotency_conflict",
    retryable: false,
    originalExecutionId: "exec_original_1",
  })
);

export const errorInsufficientScope = new Error(
  JSON.stringify({
    error: "insufficient_scope",
    code: "insufficient_scope",
    message: "This key may not broadcast.",
  })
);

export const errorSimulationUnsupportedChain = new Error(
  JSON.stringify({
    error: "simulation_unsupported_chain",
    message: "Direct-execution simulation is not supported on this chain.",
    chain_id: 101,
    hint: "Direct-execution simulation is EVM-only.",
  })
);

export const spendCap = {
  dailyCapWei: "1000000000000000000",
  dailyUsedWei: "250000000000000000",
  dailySolanaCapLamports: null,
  dailySolanaUsedLamports: "0",
  effectiveDailyCapWei: "1000000000000000000",
  effectiveDailySolanaCapLamports: "5000000000",
  usingDefaultDailyCap: false,
  usingDefaultDailySolanaCap: true,
} as const;

export const integrations = [
  {
    id: "int_wallet_1",
    name: "Treasury",
    type: "web3",
    isManaged: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    address: WALLET,
    createdByName: "Dev",
    createdByEmail: "dev@example.com",
    createdByRole: "owner",
  },
  {
    id: "int_mail_1",
    name: "Alerts",
    type: "sendgrid",
    isManaged: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    address: null,
    createdByName: "Dev",
    createdByEmail: "dev@example.com",
    createdByRole: "owner",
  },
] as const;

export type RecordedCall = { name: string; args: Record<string, unknown> };

/**
 * A KeeperHubClient stand-in that records every call.
 *
 * This is the instrument the suite measures with: the assertions are about
 * what would have reached the chain, which is only observable by capturing
 * the outbound calls. Responses are keyed by tool name; an Error value makes
 * that tool report failure the way the real client does.
 */
export function recordingClient(responses: Record<string, unknown>) {
  const calls: RecordedCall[] = [];
  const client = {
    callTool: (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args: structuredClone(args) });
      const response = responses[name];
      if (response instanceof Error) {
        return Promise.resolve({ ok: false as const, error: response.message });
      }
      if (response === undefined) {
        return Promise.resolve({
          ok: false as const,
          error: `no fixture for ${name}`,
        });
      }
      return Promise.resolve({
        ok: true as const,
        data: response,
        text: JSON.stringify(response),
      });
    },
    close: () => Promise.resolve(),
  } as unknown as KeeperHubClient;
  return { client, calls };
}

export function deps(client: KeeperHubClient) {
  return {
    getClient: () => client,
    plans: createPlanStore(),
    executions: createExecutionTracker(),
    defaultChainId: () => "11155111",
  };
}

export const message = (text: string, roomId = "room-1") =>
  ({ roomId, entityId: "entity-1", agentId: "agent-1", content: { text } }) as never;

export const runtimeReturning = (raw: string) =>
  ({
    useModel: vi.fn().mockResolvedValue(raw),
    createMemory: vi.fn().mockResolvedValue(undefined),
  }) as never;
