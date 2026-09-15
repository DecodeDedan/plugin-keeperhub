import type { IAgentRuntime, Memory, Provider, ProviderResult, State } from "@elizaos/core";
import type { KeeperHubClient } from "./client.js";
import {
  type IntegrationSummary,
  parseIntegrations,
  parseSpendCap,
  type SpendCapData,
} from "./keeperhub-types.js";
import { renderSpendCap, subtractWei } from "./render.js";

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
 * When KeeperHub cannot be reached the agent is told exactly that, and the
 * execute path refuses on its own rather than relying on this notice.
 */
export function createWalletProvider(
  getClient: () => KeeperHubClient | undefined
): Provider {
  return {
    name: "KEEPERHUB_WALLET",
    description:
      "The agent's KeeperHub wallets, the daily spending cap that is actually enforced, and how much of it is left today.",
    dynamic: false,

    get: async (
      _runtime: IAgentRuntime,
      _message: Memory,
      _state: State
    ): Promise<ProviderResult> => {
      const client = getClient();
      if (!client) {
        return unavailable(
          "KeeperHub is not configured. Onchain execution is unavailable; do not offer to move funds."
        );
      }

      const [capResponse, integrationsResponse] = await Promise.all([
        client.callTool("get_spending_limits", {}),
        client.callTool("list_integrations", {}),
      ]);

      if (!(capResponse.ok || integrationsResponse.ok)) {
        return unavailable(
          `KeeperHub is unreachable (${capResponse.error}). Do not promise onchain execution while this is true.`
        );
      }

      const wallets = integrationsResponse.ok
        ? parseIntegrations(integrationsResponse.data).filter((i) => i.type === "web3")
        : [];
      const cap = capResponse.ok ? parseSpendCap(capResponse.data) : undefined;

      return {
        text: render(wallets, cap),
        values: {
          keeperhubConfigured: true,
          keeperhubWalletCount: wallets.length,
          keeperhubRemainingWei: cap
            ? subtractWei(cap.effectiveDailyCapWei, cap.dailyUsedWei)
            : undefined,
        },
        data: { wallets, spendCap: cap },
      };
    },
  };
}

function render(wallets: IntegrationSummary[], cap: SpendCapData | undefined): string {
  const lines = ["# KeeperHub execution"];

  if (wallets.length === 0) {
    lines.push(
      "No web3 wallet is connected. Every onchain action will be refused until one is added in KeeperHub."
    );
  } else {
    lines.push("Wallets:");
    for (const wallet of wallets) {
      const address = wallet.address ? ` ${wallet.address}` : "";
      lines.push(`  ${wallet.name}${address} (integration ${wallet.id})`);
    }
  }

  if (cap) {
    lines.push("Daily value limits, as enforced:");
    lines.push(...renderSpendCap(cap));
    if (cap.usingDefaultDailyCap) {
      lines.push(
        "  note         this organization set no cap of its own, so the platform default applies. It is not unlimited."
      );
    }
  } else {
    lines.push(
      "Spending limits could not be read. Assume a cap exists and that requests above it will be refused."
    );
  }

  lines.push(
    "Value never moves directly. Proposing an action runs a dry run only; a human must approve before anything is broadcast."
  );
  return lines.join("\n");
}

function unavailable(text: string): ProviderResult {
  return { text, values: { keeperhubConfigured: false }, data: {} };
}
