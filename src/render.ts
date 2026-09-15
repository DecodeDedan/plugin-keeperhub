import {
  type ConditionOutcome,
  type ExecuteResponse,
  type ExecutionStatusResponse,
  INSUFFICIENT_BALANCE,
  type ReadResult,
  type ReceiptEntry,
  type SimulateFailure,
  type SimulateSuccess,
  type SpendCapData,
} from "./keeperhub-types.js";

/** Decimal places for the native unit on every EVM chain KeeperHub supports. */
const WEI_DECIMALS = 18;

/**
 * Format a wei-denominated integer string as its native unit.
 *
 * String arithmetic throughout: 1 ETH is 10^18 wei, which exceeds the exact
 * integer range of a double, so parsing to a number before dividing loses the
 * low-order digits of any realistic balance.
 */
export function formatWei(wei: string, decimals: number = WEI_DECIMALS): string {
  const negative = wei.startsWith("-");
  const digits = negative ? wei.slice(1) : wei;
  if (!/^\d+$/.test(digits)) {
    return wei;
  }
  const padded = digits.padStart(decimals + 1, "0");
  const whole = padded.slice(0, padded.length - decimals);
  const fraction = padded.slice(padded.length - decimals).replace(/0+$/, "");
  const body = fraction ? `${whole}.${fraction}` : whole;
  return negative ? `-${body}` : body;
}

/** Subtract two wei strings without going through a double. */
export function subtractWei(a: string, b: string): string {
  if (!(/^\d+$/.test(a) && /^\d+$/.test(b))) {
    return "0";
  }
  const difference = BigInt(a) - BigInt(b);
  return difference < 0n ? "0" : difference.toString();
}

export function renderSpendCap(cap: SpendCapData, nativeSymbol = "ETH"): string[] {
  const remaining = subtractWei(cap.effectiveDailyCapWei, cap.dailyUsedWei);
  const source = cap.usingDefaultDailyCap
    ? "platform default"
    : "set by this organization";
  return [
    `  daily cap    ${formatWei(cap.effectiveDailyCapWei)} ${nativeSymbol} (${source})`,
    `  used today   ${formatWei(cap.dailyUsedWei)} ${nativeSymbol}`,
    `  remaining    ${formatWei(remaining)} ${nativeSymbol}`,
  ];
}

/**
 * Describe a dry run that KeeperHub says would succeed.
 *
 * `simulatedReturnValue` is rendered only when the call actually returns
 * something, so a plain transfer does not carry an empty line claiming a
 * return value exists.
 */
export function renderSimulateSuccess(result: SimulateSuccess): string[] {
  const lines = [`  gas estimate ${result.gasEstimate || "unavailable"}`];
  if (result.from) {
    lines.push(`  from         ${result.from}`);
  }
  if (
    result.simulatedReturnValue !== undefined &&
    result.simulatedReturnValue !== null &&
    result.simulatedReturnValue !== ""
  ) {
    lines.push(`  returns      ${formatReturnValue(result.simulatedReturnValue)}`);
  }
  return lines;
}

/**
 * Explain a dry run that did not pass, in the terms the failure was actually
 * reported in.
 *
 * The three kinds are genuinely different events and are never merged: a
 * revert means the chain rejected the call, a validation failure means it was
 * never sent, and unavailable means nothing was learned either way.
 */
export function renderSimulateFailure(failure: SimulateFailure): string {
  const lines: string[] = [];

  switch (failure.failureKind) {
    case "revert":
      lines.push("The dry run reached the chain and the call would revert.");
      break;
    case "validation":
      lines.push("The request did not pass validation, so it was never sent to the chain.");
      break;
    case "unavailable":
      lines.push(
        "The simulator could not reach the chain, so nothing is known about whether this call would succeed."
      );
      break;
    default: {
      const exhaustive: never = failure.failureKind;
      lines.push(String(exhaustive));
    }
  }

  const reason = failure.revertReason ?? failure.error;
  if (reason) {
    lines.push(`  reason       ${reason}`);
  }
  if (failure.originalError && failure.originalError !== reason) {
    lines.push(`  chain said   ${failure.originalError}`);
  }

  if (failure.code === INSUFFICIENT_BALANCE) {
    const symbol = failure.nativeSymbol ?? "ETH";
    if (failure.balanceWei) {
      lines.push(`  balance      ${formatWei(failure.balanceWei)} ${symbol}`);
    }
    if (failure.requiredWei) {
      lines.push(`  required     ${formatWei(failure.requiredWei)} ${symbol}`);
    }
    if (failure.shortfallWei) {
      lines.push(`  short by     ${formatWei(failure.shortfallWei)} ${symbol}`);
    }
  }

  if (failure.undecodedRevertData) {
    lines.push(
      `  revert data  ${failure.undecodedRevertData} (no ABI entry matched; look up the first four bytes to identify the custom error)`
    );
  }

  return lines.join("\n");
}

/**
 * Report what a broadcast did.
 *
 * Three outcomes, never collapsed into two: settled on chain, settled as a
 * failure, and broadcast but not yet confirmed. The third is the one that
 * matters, because presenting it as either of the others invites a retry of a
 * transfer that may already have landed.
 */
export function renderExecuteResponse(response: ExecuteResponse): string {
  const lines: string[] = [];

  switch (response.status) {
    case "completed":
      lines.push("Executed the plan you approved. The chain confirmed it.");
      break;
    case "failed":
      lines.push("The execution failed.");
      break;
    case "unconfirmed":
      lines.push(
        "Broadcast. The transaction is on chain but not yet confirmed, so this is not final yet. Do not re-send it; ask me to check the status instead."
      );
      break;
    case "pending":
    case "running":
      lines.push(
        "Accepted and in progress. Not final yet. Do not re-send it; ask me to check the status instead."
      );
      break;
    default: {
      const exhaustive: never = response.status;
      lines.push(String(exhaustive));
    }
  }

  if (response.idempotentReplay) {
    // Without this a retry reads a stored failure as a fresh one and keeps
    // retrying work that was never re-sent.
    lines.push(
      "This is a replay of the original response for this key. Nothing was sent again."
    );
  }

  lines.push(`  execution    ${response.executionId}`);
  if (response.transactionHash) {
    lines.push(`  transaction  ${response.transactionHash}`);
  }
  if (response.transactionLink) {
    lines.push(`  explorer     ${response.transactionLink}`);
  }
  if (response.error) {
    lines.push(`  error        ${response.error}`);
  }
  if (response.rejection) {
    lines.push(`  rejection    ${response.rejection}`);
  }
  return lines.join("\n");
}

/**
 * Render the onchain receipts.
 *
 * These are the authoritative evidence: each entry was re-fetched from the
 * chain, so `verified` and `receiptStatus` say what actually happened, while
 * `transactionHash` only identifies a transaction the write path claimed.
 */
export function renderReceipts(receipts: ReceiptEntry[]): string[] {
  if (receipts.length === 0) {
    return ["  receipts     none yet (nothing verified against the chain)"];
  }
  const lines = ["  receipts"];
  for (const receipt of receipts) {
    const verified = receipt.verified ? "verified" : "unverified";
    lines.push(`    ${receipt.hash}  ${receipt.receiptStatus}, ${verified}`);
    if (receipt.blockNumber !== undefined) {
      lines.push(`      block ${receipt.blockNumber}`);
    }
    if (receipt.gasUsed) {
      lines.push(`      gas ${receipt.gasUsed}`);
    }
  }
  return lines;
}

/** A view or pure call: a value, nothing to approve. */
export function renderReadResult(read: ReadResult): string {
  return [
    "That is a read-only call, so there is nothing to approve and nothing to broadcast.",
    `  result       ${formatValue(read.result)}`,
  ].join("\n");
}

/** A conditional check that did not fire. */
export function renderConditionNotMet(outcome: ConditionOutcome): string {
  const { conditionResult: condition } = outcome;
  const lines = [
    "The condition does not hold, so no action would be taken and there is nothing to approve.",
  ];
  if (condition.observedValue !== undefined) {
    lines.push(`  observed     ${condition.observedValue}`);
  }
  if (condition.operator && condition.targetValue !== undefined) {
    lines.push(`  required     ${condition.operator} ${condition.targetValue}`);
  }
  return lines.join("\n");
}

export function renderExecutionStatus(status: ExecutionStatusResponse): string {
  const lines = [`Execution ${status.executionId} is ${status.status}.`];
  if (status.transactionHash) {
    lines.push(`  transaction  ${status.transactionHash}`);
  }
  if (status.transactionLink) {
    lines.push(`  explorer     ${status.transactionLink}`);
  }
  if (status.network) {
    lines.push(`  network      ${status.network}`);
  }
  if (status.gasUsedWei) {
    lines.push(`  gas used     ${status.gasUsedWei}`);
  }
  if (status.estimatedCostUsd) {
    lines.push(`  cost         ${status.estimatedCostUsd} USD`);
  }
  if (status.error) {
    lines.push(`  error        ${status.error}`);
  }
  lines.push(...renderReceipts(status.receipts));
  return lines.join("\n");
}

/** Render a contract return value without collapsing structure into "[object Object]". */
export function formatValue(value: unknown): string {
  return formatReturnValue(value);
}

function formatReturnValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  return JSON.stringify(value);
}
