import type { IAgentRuntime, Memory, Provider, State } from "@elizaos/core";
import type { KeeperHubClient } from "./client.js";

/**
 * Puts the agent's real execution limits into its context.
 *
 * Without this the agent reasons about spending from whatever it inferred
 * from conversation, then discovers the cap only when an execute call is
 * refused. Reading the enforced numbers up front means a plan that cannot
 * clear policy is never proposed to the human in the first place.
 *
 * Failure here is deliberately soft: a provider that throws takes down every
 * turn of the agent, including the ones that have nothing to do with money.
 * If KeeperHub cannot be reached the agent is told exactly that, and the
 * execute path refuses on its own.
 */
export function createWalletProvider(
  getClient: () => KeeperHubClient | undefined
): Provider {
  return {
    name: "KEEPERHUB_WALLET",
    description:
      "The agent's KeeperHub wallet, its enforced daily spending caps, and usage so far.",
    dynamic: false,

    async get(
      _runtime: IAgentRuntime,
      _message: Memory,
      _state: State
    ): Promise<{ text: string; values: Record<string, unknown>; data: Record<string, unknown> }> {
      const client = getClient();
      if (!client) {
        return empty("KeeperHub is not configured; onchain execution is unavailable.");
      }

      const [limits, integrations] = await Promise.all([
        client.callTool("get_spending_limits", {}),
        client.callTool("list_integrations", {}),
      ]);

      if (!limits.ok && !integrations.ok) {
        return empty(`KeeperHub is unreachable (${limits.error}). Do not promise onchain execution.`);
      }

      const wallets = integrations.ok ? web3Integrations(integrations.data) : [];
      const limitData = limits.ok ? limits.data : undefined;

      return {
        text: render(wallets, limitData),
        values: {
          keeperhubConfigured: true,
          keeperhubWalletCount: wallets.length,
        },
        data: { wallets, limits: limitData },
      };
    },
  };
}

type WalletSummary = { id: string; name: string };

function web3Integrations(data: unknown): WalletSummary[] {
  const list = Array.isArray(data)
    ? data
    : (data as { integrations?: unknown } | undefined)?.integrations;
  if (!Array.isArray(list)) {
    return [];
  }
  const wallets: WalletSummary[] = [];
  for (const entry of list) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    if (record.type !== "web3") {
      continue;
    }
    wallets.push({
      id: String(record.id ?? ""),
      name: String(record.name ?? "unnamed wallet"),
    });
  }
  return wallets;
}

function render(wallets: WalletSummary[], limits: unknown): string {
  const lines = ["# KeeperHub execution"];

  if (wallets.length === 0) {
    lines.push(
      "No web3 wallet is connected. Onchain execution will be refused until one is added."
    );
  } else {
    lines.push(
      `Wallets available: ${wallets.map((w) => `${w.name} (${w.id})`).join(", ")}`
    );
  }

  const caps = limits as Record<string, unknown> | undefined;
  if (caps) {
    const cap = caps.effectiveDailyCapWei;
    const used = caps.dailySpentWei ?? caps.spentWei;
    if (cap !== undefined && cap !== null) {
      lines.push(`Enforced daily cap: ${formatWei(cap)} ETH.`);
    }
    if (used !== undefined && used !== null) {
      lines.push(`Spent today: ${formatWei(used)} ETH.`);
    }
  }

  lines.push(
    "Value never moves directly. Proposing a transfer runs a dry run only; a human must approve before anything is broadcast."
  );
  return lines.join("\n");
}

/** wei -> ETH, string maths so large values do not lose precision through float. */
function formatWei(value: unknown): string {
  const raw = String(value);
  if (!/^\d+$/.test(raw)) {
    return raw;
  }
  const padded = raw.padStart(19, "0");
  const whole = padded.slice(0, -18);
  const fraction = padded.slice(-18).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

function empty(text: string): {
  text: string;
  values: Record<string, unknown>;
  data: Record<string, unknown>;
} {
  return { text, values: { keeperhubConfigured: false }, data: {} };
}
