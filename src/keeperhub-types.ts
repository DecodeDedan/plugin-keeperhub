/**
 * The shapes KeeperHub actually returns.
 *
 * Every type here is transcribed from KeeperHub source rather than inferred
 * from a response seen once. The file reference on each block is where to
 * re-check it when KeeperHub changes:
 *
 *   SimulateSuccess / SimulateFailure  lib/execute/simulate.ts
 *   ExecuteResponse / ExecutionStatus  app/api/execute/_lib/types.ts
 *   ExecutionStatusResponse            app/api/execute/_lib/types.ts
 *   SpendCapData                       lib/analytics/queries.ts getSpendCapData
 *   IntegrationSummary                 app/api/integrations/route.ts GET
 *
 * These are parsed with explicit guards rather than cast, because the values
 * arrive as JSON over MCP and a cast would assert a shape nothing checked.
 */

/** Only `completed` and `failed` are terminal. */
export type ExecutionStatus =
  | "pending"
  | "running"
  | "unconfirmed"
  | "completed"
  | "failed";

export const TERMINAL_STATUSES: readonly ExecutionStatus[] = [
  "completed",
  "failed",
];

/**
 * `unconfirmed` means the transaction reached the chain but has not been
 * confirmed. KeeperHub documents this as deliberately distinct from `failed`:
 * a caller that reads a live transaction as failed will retry, and retrying a
 * fund-moving action is the worst available outcome. It is never reported as
 * either success or failure here.
 */
export function isTerminal(status: ExecutionStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export type SimulateSuccess = {
  success: true;
  status: "simulated";
  from: string;
  to: string;
  value: string;
  gasEstimate: string;
  simulatedReturnValue: unknown;
  wouldRevert: false;
};

/** The one machine-readable cause the simulator currently attributes. */
export const INSUFFICIENT_BALANCE = "insufficient_balance";

export type SimulationFailureKind = "validation" | "revert" | "unavailable";

export type SimulateFailure = {
  success: false;
  status: "simulated";
  from: string;
  to: string;
  value: string;
  error: string;
  failureKind: SimulationFailureKind;
  /**
   * False when `failureKind` is "unavailable": the simulator could not reach
   * the chain, which is not the same claim as "this call reverts". Conflating
   * them tells a user their transaction is broken when the truth is that
   * nothing was learned about it.
   */
  wouldRevert: boolean;
  revertReason?: string;
  code?: string;
  balanceWei?: string;
  requiredWei?: string;
  shortfallWei?: string;
  nativeSymbol?: string;
  originalError?: string;
  undecodedRevertData?: string;
};

export type SimulateResult = SimulateSuccess | SimulateFailure;

export type ExecuteResponse = {
  executionId: string;
  status: ExecutionStatus;
  transactionHash?: string | null;
  transactionLink?: string | null;
  error?: string;
  rejection?: string;
  errorClass?: string;
  /**
   * Present only on a replay, and always true. Without surfacing it a retry
   * loop reads a stored failure as a fresh one -- "still reverting" when in
   * fact no transaction was sent this time.
   */
  idempotentReplay?: boolean;
};

/**
 * Per-hash onchain verification evidence. KeeperHub documents these as the
 * authoritative proof of what happened: `transactionHash` and
 * `transactionLink` merely identify a transaction and are self-reported by
 * the write path, whereas a receipt was re-fetched from the chain.
 */
export type ReceiptEntry = {
  hash: string;
  chainId?: number;
  network?: string;
  verified: boolean;
  receiptStatus:
    | "success"
    | "reverted"
    | "not_found"
    | "timeout"
    | "safe_inner_failure";
  blockNumber?: number;
  gasUsed?: string;
  verifiedAt: string;
};

/**
 * A view or pure call returns its value immediately instead of a simulation
 * envelope, because there is nothing to broadcast and so nothing to dry run.
 */
export type ReadResult = { result: unknown };

/**
 * A conditional check whose condition did not hold takes no action, and says
 * so instead of returning a simulation envelope.
 */
export type ConditionOutcome = {
  executed: boolean;
  conditionResult: {
    met: boolean;
    observedValue?: string;
    targetValue?: string;
    operator?: string;
  };
  executionId?: string;
  status?: ExecutionStatus;
};

/**
 * The structured body KeeperHub puts inside a failed tool result.
 *
 * `retryable` appears on the two idempotency 409s only, and there the two
 * codes mean opposite things: `idempotency_in_progress` must be retried under
 * the SAME key, while `idempotency_conflict` must not be retried at all.
 */
export type KeeperHubError = {
  error?: string;
  message?: string;
  code?: string;
  retryable?: boolean;
  originalExecutionId?: string;
  hint?: string;
  chainId?: number;
};

export const ERROR_IDEMPOTENCY_IN_PROGRESS = "idempotency_in_progress";
export const ERROR_IDEMPOTENCY_CONFLICT = "idempotency_conflict";
export const ERROR_INSUFFICIENT_SCOPE = "insufficient_scope";
export const ERROR_SIMULATION_UNSUPPORTED_CHAIN = "simulation_unsupported_chain";

/** Solana mainnet and devnet. Direct-execution simulation is EVM-only. */
export const SOLANA_CHAIN_IDS: readonly string[] = ["101", "103"];

export function isSolanaChainId(chainId: string): boolean {
  return SOLANA_CHAIN_IDS.includes(chainId.trim());
}

export type ExecutionStatusResponse = {
  executionId: string;
  status: ExecutionStatus;
  type: string;
  transactionHash: string | null;
  transactionLink: string | null;
  sponsored: boolean;
  receipts: ReceiptEntry[];
  result: unknown;
  error: string | null;
  gasUsedWei: string | null;
  gasPriceWei: string | null;
  estimatedCostUsd: string | null;
  retryCount: number;
  network: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type SpendCapData = {
  dailyCapWei: string | null;
  dailyUsedWei: string;
  dailySolanaCapLamports: string | null;
  dailySolanaUsedLamports: string;
  effectiveDailyCapWei: string;
  effectiveDailySolanaCapLamports: string;
  usingDefaultDailyCap: boolean;
  usingDefaultDailySolanaCap: boolean;
};

export type IntegrationSummary = {
  id: string;
  name: string;
  type: string;
  isManaged: boolean;
  createdAt: string;
  updatedAt: string;
  address: string | null;
};

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

const EXECUTION_STATUSES: readonly string[] = [
  "pending",
  "running",
  "unconfirmed",
  "completed",
  "failed",
];

function asExecutionStatus(value: unknown): ExecutionStatus | undefined {
  return typeof value === "string" && EXECUTION_STATUSES.includes(value)
    ? (value as ExecutionStatus)
    : undefined;
}

const FAILURE_KINDS: readonly string[] = ["validation", "revert", "unavailable"];

/**
 * A simulate call answers with `status: "simulated"`. Anything else came from
 * a different code path and must not be read as a dry run, which is what
 * makes this a guard rather than a cast.
 */
export function parseSimulateResult(value: unknown): SimulateResult | undefined {
  if (!isRecord(value) || value.status !== "simulated") {
    return;
  }
  const from = str(value.from) ?? "";
  const to = str(value.to) ?? "";
  const amount = str(value.value) ?? "";

  if (value.success === true) {
    return {
      success: true,
      status: "simulated",
      from,
      to,
      value: amount,
      gasEstimate: str(value.gasEstimate) ?? "",
      simulatedReturnValue: value.simulatedReturnValue,
      wouldRevert: false,
    };
  }
  if (value.success !== false) {
    return;
  }

  const kind = typeof value.failureKind === "string" && FAILURE_KINDS.includes(value.failureKind)
    ? (value.failureKind as SimulationFailureKind)
    : "validation";

  return {
    success: false,
    status: "simulated",
    from,
    to,
    value: amount,
    error: str(value.error) ?? "the simulation failed without a message",
    failureKind: kind,
    // Trust the reported flag; fall back to the kind when it is absent, since
    // "unavailable" is the one kind that is explicitly not a revert.
    wouldRevert:
      typeof value.wouldRevert === "boolean"
        ? value.wouldRevert
        : kind !== "unavailable",
    revertReason: str(value.revertReason),
    code: str(value.code),
    balanceWei: str(value.balanceWei),
    requiredWei: str(value.requiredWei),
    shortfallWei: str(value.shortfallWei),
    nativeSymbol: str(value.nativeSymbol),
    originalError: str(value.originalError),
    undecodedRevertData: str(value.undecodedRevertData),
  };
}

export function parseExecuteResponse(value: unknown): ExecuteResponse | undefined {
  if (!isRecord(value)) {
    return;
  }
  const executionId = str(value.executionId);
  const status = asExecutionStatus(value.status);
  if (!executionId || !status) {
    return;
  }
  return {
    executionId,
    status,
    transactionHash: str(value.transactionHash) ?? null,
    transactionLink: str(value.transactionLink) ?? null,
    error: str(value.error),
    rejection: str(value.rejection),
    errorClass: str(value.errorClass),
    ...(value.idempotentReplay === true ? { idempotentReplay: true } : {}),
  };
}

const RECEIPT_STATUSES: readonly string[] = [
  "success",
  "reverted",
  "not_found",
  "timeout",
  "safe_inner_failure",
];

export function parseReceipts(value: unknown): ReceiptEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: ReceiptEntry[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }
    const hash = str(entry.hash);
    const receiptStatus = str(entry.receiptStatus);
    if (!hash || !(receiptStatus && RECEIPT_STATUSES.includes(receiptStatus))) {
      continue;
    }
    out.push({
      hash,
      chainId: typeof entry.chainId === "number" ? entry.chainId : undefined,
      network: str(entry.network),
      verified: entry.verified === true,
      receiptStatus: receiptStatus as ReceiptEntry["receiptStatus"],
      blockNumber: typeof entry.blockNumber === "number" ? entry.blockNumber : undefined,
      gasUsed: str(entry.gasUsed),
      verifiedAt: str(entry.verifiedAt) ?? "",
    });
  }
  return out;
}

/**
 * A view or pure call's immediate result. Distinguished from a simulation by
 * the absence of the simulation envelope, so it is only recognised as a read
 * when `result` is the shape present.
 */
export function parseReadResult(value: unknown): ReadResult | undefined {
  if (!isRecord(value) || !("result" in value)) {
    return;
  }
  if (value.status === "simulated" || "executed" in value) {
    return;
  }
  return { result: value.result };
}

export function parseConditionOutcome(value: unknown): ConditionOutcome | undefined {
  if (!isRecord(value) || typeof value.executed !== "boolean") {
    return;
  }
  const condition = isRecord(value.conditionResult) ? value.conditionResult : {};
  return {
    executed: value.executed,
    conditionResult: {
      met: condition.met === true,
      observedValue: str(condition.observedValue),
      targetValue: str(condition.targetValue),
      operator: str(condition.operator),
    },
    executionId: str(value.executionId),
    status: asExecutionStatus(value.status),
  };
}

/**
 * Pull KeeperHub's structured error out of a failed tool result.
 *
 * A revert or an invalid simulation is surfaced as an MCP tool error rather
 * than a successful response carrying `success: false`, so the useful detail
 * arrives on the error path and has to be recovered from there.
 */
/**
 * Recover the structured body from a failed tool result.
 *
 * KeeperHub embeds the REST error JSON inside a longer human-readable error
 * message ("API call failed: 400 Bad Request - {...}" followed by guidance),
 * so the body is not the parsed `data` and has to be cut out of the text.
 * Both the simulation parser and the error parser need it, and reading it once
 * keeps them from disagreeing about what the response said.
 */
export function recoverErrorBody(data: unknown, text?: string): unknown {
  if (isRecord(data)) {
    return data;
  }
  return extractJson(typeof data === "string" ? data : text) ?? extractJson(text);
}

export function parseKeeperHubError(
  data: unknown,
  text?: string
): KeeperHubError | undefined {
  const recovered = recoverErrorBody(data, text);
  const source = isRecord(recovered) ? recovered : undefined;
  if (!source) {
    return;
  }
  const chainId = source.chain_id ?? source.chainId;
  return {
    error: str(source.error),
    message: str(source.message),
    code: str(source.code),
    retryable: typeof source.retryable === "boolean" ? source.retryable : undefined,
    originalExecutionId: str(source.originalExecutionId),
    hint: str(source.hint),
    chainId: typeof chainId === "number" ? chainId : undefined,
  };
}

/** Error text often wraps the REST error JSON in a sentence; recover it. */
function extractJson(text: string | undefined): Record<string, unknown> | undefined {
  if (!text) {
    return;
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) {
    return;
  }
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return;
  }
}

export function parseExecutionStatus(
  value: unknown
): ExecutionStatusResponse | undefined {
  if (!isRecord(value)) {
    return;
  }
  const executionId = str(value.executionId);
  const status = asExecutionStatus(value.status);
  if (!executionId || !status) {
    return;
  }
  return {
    executionId,
    status,
    type: str(value.type) ?? "",
    transactionHash: str(value.transactionHash) ?? null,
    transactionLink: str(value.transactionLink) ?? null,
    sponsored: value.sponsored === true,
    receipts: parseReceipts(value.receipts),
    result: value.result,
    error: str(value.error) ?? null,
    gasUsedWei: str(value.gasUsedWei) ?? null,
    gasPriceWei: str(value.gasPriceWei) ?? null,
    estimatedCostUsd: str(value.estimatedCostUsd) ?? null,
    retryCount: typeof value.retryCount === "number" ? value.retryCount : 0,
    network: str(value.network) ?? null,
    createdAt: str(value.createdAt) ?? "",
    completedAt: str(value.completedAt) ?? null,
  };
}

export function parseSpendCap(value: unknown): SpendCapData | undefined {
  if (!isRecord(value)) {
    return;
  }
  const effectiveDailyCapWei = str(value.effectiveDailyCapWei);
  const dailyUsedWei = str(value.dailyUsedWei);
  if (effectiveDailyCapWei === undefined || dailyUsedWei === undefined) {
    return;
  }
  return {
    dailyCapWei: str(value.dailyCapWei) ?? null,
    dailyUsedWei,
    dailySolanaCapLamports: str(value.dailySolanaCapLamports) ?? null,
    dailySolanaUsedLamports: str(value.dailySolanaUsedLamports) ?? "0",
    effectiveDailyCapWei,
    effectiveDailySolanaCapLamports:
      str(value.effectiveDailySolanaCapLamports) ?? "0",
    usingDefaultDailyCap: value.usingDefaultDailyCap === true,
    usingDefaultDailySolanaCap: value.usingDefaultDailySolanaCap === true,
  };
}

/** `GET /api/integrations` answers with a bare array. */
export function parseIntegrations(value: unknown): IntegrationSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: IntegrationSummary[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }
    const id = str(entry.id);
    const type = str(entry.type);
    if (!(id && type)) {
      continue;
    }
    out.push({
      id,
      name: str(entry.name) ?? "unnamed",
      type,
      isManaged: entry.isManaged === true,
      createdAt: str(entry.createdAt) ?? "",
      updatedAt: str(entry.updatedAt) ?? "",
      address: str(entry.address) ?? null,
    });
  }
  return out;
}
