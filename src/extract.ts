import { z } from "zod";

/**
 * Turning a sentence into transfer arguments is the one place a language
 * model is allowed to decide anything. It is safe here only because what it
 * produces is dry run and shown to a human before it can move value -- and
 * because the shape is validated rather than trusted. A model that answers
 * with a negative amount, a malformed address or scientific notation is
 * rejected outright instead of being handed to an execute endpoint.
 */

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** Plain positive decimal. No sign, no exponent, no thousands separators. */
const POSITIVE_DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

const addressSchema = z
  .string()
  .trim()
  .refine((v) => EVM_ADDRESS.test(v) || BASE58_ADDRESS.test(v), {
    message: "not a recognisable EVM (0x...) or Solana (base58) address",
  });

const amountSchema = z
  .string()
  .trim()
  .refine((v) => POSITIVE_DECIMAL.test(v), {
    message: "amount must be a plain decimal string such as '0.1'",
  })
  .refine((v) => Number.parseFloat(v) > 0, {
    message: "amount must be greater than zero",
  });

export const transferIntentSchema = z.object({
  to_address: addressSchema,
  amount: amountSchema,
  token_address: addressSchema.optional(),
  chain_id: z
    .string()
    .trim()
    .regex(/^\d+$/, "chain_id must be a numeric string")
    .optional(),
});

export type TransferIntent = z.infer<typeof transferIntentSchema>;

/**
 * KeeperHub takes `function_args` as a JSON array *encoded as a string*, not
 * as an array. Models emit both. Normalising here means the stored plan holds
 * the wire form, so confirm replays exactly what was dry run rather than
 * re-serialising at broadcast time and risking a different string.
 */
const functionArgsSchema = z
  .union([z.string(), z.array(z.unknown())])
  .transform((v) => (typeof v === "string" ? v.trim() : JSON.stringify(v)))
  .refine((v) => {
    try {
      return Array.isArray(JSON.parse(v));
    } catch {
      return false;
    }
  }, { message: "function_args must be a JSON array" });

export const contractCallIntentSchema = z.object({
  contract_address: addressSchema,
  function_name: z
    .string()
    .trim()
    .regex(/^[A-Za-z_$][\w$]*$/, "function_name must be a Solidity identifier"),
  function_args: functionArgsSchema.optional(),
  chain_id: z
    .string()
    .trim()
    .regex(/^\d+$/, "chain_id must be a numeric string")
    .optional(),
  value: amountSchema.optional(),
});

export type ContractCallIntent = z.infer<typeof contractCallIntentSchema>;

export const CONTRACT_CALL_PROMPT = `Extract a smart contract function call from the user message.

Respond with ONLY a JSON object, no prose and no code fence, with these keys:
  contract_address (string, required) the contract address exactly as written
  function_name    (string, required) the Solidity function name
  function_args    (array, optional)  the arguments in order, each as a string
  chain_id         (string, optional) numeric chain id if the user named a chain
  value            (string, optional) native token to send, decimal, for payable functions

Copy addresses, names and values character for character. Never invent, round,
complete or correct them, and never guess an argument the user did not give.
If the message does not name both a contract and a function, respond with
exactly: null`;

export const EXTRACTION_PROMPT = `Extract a token transfer request from the user message.

Respond with ONLY a JSON object, no prose and no code fence, with these keys:
  to_address    (string, required) the recipient address exactly as written
  amount        (string, required) a plain decimal such as "0.1", never a number
  token_address (string, optional) ERC20 contract address; omit for native transfers
  chain_id      (string, optional) numeric chain id if the user named a chain

Copy addresses and amounts character for character. Never invent, round,
complete or correct them. If the message does not contain both a recipient
and an amount, respond with exactly: null`;

export type ExtractResult<T> =
  | { ok: true; intent: T }
  | { ok: false; reason: string };

/**
 * Parse a model response into a validated transfer intent.
 *
 * Split out from the model call so the parsing and validation rules can be
 * tested against fixed strings rather than against a live model.
 */
export function parseTransferIntent(raw: unknown): ExtractResult<TransferIntent> {
  return parseIntent(raw, transferIntentSchema);
}

/** Parse a model response into a validated contract-call intent. */
export function parseContractCallIntent(
  raw: unknown
): ExtractResult<ContractCallIntent> {
  return parseIntent(raw, contractCallIntentSchema);
}

function parseIntent<T>(
  raw: unknown,
  schema: z.ZodType<T>
): ExtractResult<T> {
  const text = typeof raw === "string" ? raw : JSON.stringify(raw);
  if (!text) {
    return { ok: false, reason: "empty response" };
  }

  const candidate = stripFence(text.trim());
  if (candidate === "null") {
    return { ok: false, reason: "no transfer intent in message" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return { ok: false, reason: "response was not valid JSON" };
  }

  if (parsed === null) {
    return { ok: false, reason: "no transfer intent in message" };
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    return { ok: false, reason: detail };
  }
  return { ok: true, intent: result.data };
}

/** Models wrap JSON in a code fence often enough to be worth handling. */
function stripFence(text: string): string {
  if (!text.startsWith("```")) {
    return text;
  }
  const withoutOpen = text.replace(/^```(?:json)?\s*/i, "");
  const close = withoutOpen.lastIndexOf("```");
  return (close === -1 ? withoutOpen : withoutOpen.slice(0, close)).trim();
}
