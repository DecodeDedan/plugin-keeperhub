import { createHash } from "node:crypto";

/**
 * Derivation of a stable `idempotency_key`, per KeeperHub's documented rule
 * (docs/api/direct-execution.md, "Choosing a stable key").
 *
 * The rule exists because of a specific failure: a UUID generated per attempt
 * does not survive a retry. The second attempt generates a different key, the
 * request is treated as new, and the transfer executes a second time. A key
 * must therefore identify the WORK, not the attempt.
 *
 * Here the work is the reviewed plan. A `taskId` is minted once, when the dry
 * run queues the plan, and lives on the plan -- which is the "persisted before
 * the first attempt and recovered afterwards" case the documentation allows.
 * Every broadcast of that one plan derives the same key; a fresh dry run is
 * different work and gets a different key, so two deliberate identical
 * transfers do not collide inside the 24-hour replay window.
 *
 * The canonicalisation below is not cosmetic. It is specified so that two
 * conforming implementations cannot disagree about whether two requests are
 * the same work, which is what makes replay protection meaningful.
 */

/** Single ASCII vertical bar, U+007C, with no surrounding whitespace. */
const SEPARATOR = "|";

export class CanonicalizationError extends Error {}

/**
 * `taskId` is opaque, so it is not case-folded. `%` and `|` are percent-encoded
 * so a task id containing a bar cannot shift the meaning of later fields: a
 * taskId of `8453|0xabc` on chain `1` would otherwise join to the same string
 * as a different intent on chain `8453`.
 */
export function canonicalizeTaskId(value: string): string {
  return value.trim().replaceAll("%", "%25").replaceAll("|", "%7C");
}

/** Decimal integer form with no leading zeros, so `8453` and `08453` agree. */
export function canonicalizeChainId(value: string): string {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new CanonicalizationError(
      `chain id must already be resolved to a decimal integer, got "${value}"`
    );
  }
  const stripped = trimmed.replace(/^0+/, "");
  return stripped === "" ? "0" : stripped;
}

/** Lowercased, so a checksummed and an unchecksummed address agree. */
export function canonicalizeAddress(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Decimal string form, never a binary float.
 *
 * The string form is required rather than a numeric type because parsing
 * "0.1" as a 64-bit float yields 0.100000000000000006, and because binary
 * floats collapse distinct 18-decimal amounts onto one value.
 */
export function canonicalizeAmount(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("+") || trimmed.startsWith("-")) {
    throw new CanonicalizationError(`amount must not carry a sign, got "${value}"`);
  }
  if (/[eE]/.test(trimmed)) {
    throw new CanonicalizationError(`amount must not use exponent notation, got "${value}"`);
  }
  if (!/^\d*(?:\.\d*)?$/.test(trimmed) || !/\d/.test(trimmed)) {
    throw new CanonicalizationError(`amount must be a decimal number, got "${value}"`);
  }

  const [rawWhole = "", rawFraction = ""] = trimmed.split(".");
  const whole = rawWhole.replace(/^0+/, "");
  const fraction = rawFraction.replace(/0+$/, "");
  const joined = fraction ? `${whole === "" ? "0" : whole}.${fraction}` : whole;
  return joined === "" ? "0" : joined;
}

/** Omitted optional fields are the empty string, so separator positions stay fixed. */
function optional(value: unknown, canonicalize: (v: string) => string): string {
  if (value === undefined || value === null || value === "") {
    return "";
  }
  return canonicalize(String(value));
}

/**
 * The fields that determine the onchain effect, per tool.
 *
 * KeeperHub documents the transfer join explicitly; the other two follow the
 * same rule -- the caller's stable identifier joined with everything that
 * decides what happens on chain -- so that a retry of one plan cannot be
 * mistaken for different work, or vice versa.
 */
function effectFields(tool: string, args: Record<string, unknown>): string[] {
  switch (tool) {
    case "execute_transfer":
      return [
        canonicalizeChainId(String(args.chain_id ?? "")),
        optional(args.to_address, canonicalizeAddress),
        optional(args.amount, canonicalizeAmount),
        optional(args.token_address, canonicalizeAddress),
      ];
    case "execute_contract_call":
      return [
        canonicalizeChainId(String(args.chain_id ?? "")),
        optional(args.contract_address, canonicalizeAddress),
        String(args.function_name ?? ""),
        String(args.function_args ?? ""),
        optional(args.value, canonicalizeAmount),
      ];
    case "execute_check_and_execute": {
      const condition = (args.condition ?? {}) as Record<string, unknown>;
      const action = (args.action ?? {}) as Record<string, unknown>;
      return [
        canonicalizeChainId(String(args.chain_id ?? "")),
        optional(args.contract_address, canonicalizeAddress),
        String(args.function_name ?? ""),
        String(args.function_args ?? ""),
        String(condition.operator ?? ""),
        String(condition.value ?? ""),
        optional(action.contract_address, canonicalizeAddress),
        String(action.function_name ?? ""),
        String(action.function_args ?? ""),
      ];
    }
    default:
      throw new CanonicalizationError(`no idempotency rule for tool "${tool}"`);
  }
}

/**
 * Build the canonical string a key is hashed from. Exposed so a test can
 * assert the exact join rather than only the digest, which would hide a
 * separator or ordering mistake behind an opaque hash.
 */
export function canonicalString(
  taskId: string,
  tool: string,
  args: Record<string, unknown>
): string {
  return [canonicalizeTaskId(taskId), ...effectFields(tool, args)].join(SEPARATOR);
}

/** SHA-256 of the canonical string's UTF-8 bytes, as lowercase hex. */
export function deriveIdempotencyKey(
  taskId: string,
  tool: string,
  args: Record<string, unknown>
): string {
  return createHash("sha256")
    .update(canonicalString(taskId, tool, args), "utf8")
    .digest("hex");
}
