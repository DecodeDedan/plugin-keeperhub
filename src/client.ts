import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const DEFAULT_MCP_URL = "https://app.keeperhub.com/mcp";

export type KeeperHubConfig = {
  apiKey: string;
  mcpUrl: string;
  defaultChainId: string;
};

/**
 * Reads config from any source of key/value settings (Eliza's
 * runtime.getSetting, or process.env).
 *
 * Settings arrive loosely typed -- Eliza hands back whatever the character
 * file or environment held, which may be a number or a boolean -- so every
 * value is narrowed to a non-empty string here rather than at each use.
 */
export function readConfig(
  get: (key: string) => unknown
): KeeperHubConfig | undefined {
  const apiKey = asString(get("KEEPERHUB_API_KEY"));
  if (!apiKey) {
    return;
  }
  return {
    apiKey,
    mcpUrl: asString(get("KEEPERHUB_MCP_URL")) ?? DEFAULT_MCP_URL,
    defaultChainId: asString(get("KEEPERHUB_DEFAULT_CHAIN_ID")) ?? "11155111",
  };
}

function asString(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") {
    return;
  }
  return String(value);
}

/**
 * Thin MCP client over KeeperHub's server.
 *
 * KeeperHub tools answer with a single text block holding JSON, so callTool
 * parses that back out. A tool that reports an error returns it as `isError`
 * with the message in the same text block rather than throwing, so both
 * shapes are normalised into one result type here and every caller handles
 * failure the same way.
 */
export class KeeperHubClient {
  private client: Client | undefined;
  private connecting: Promise<Client> | undefined;

  constructor(private readonly config: KeeperHubConfig) {}

  private async connect(): Promise<Client> {
    if (this.client) {
      return this.client;
    }
    // Concurrent callers share one in-flight connect rather than opening
    // a transport each; the provider and an action can fire together.
    if (!this.connecting) {
      this.connecting = (async () => {
        const client = new Client(
          { name: "plugin-keeperhub", version: "0.1.0" },
          { capabilities: {} }
        );
        const transport = new StreamableHTTPClientTransport(
          new URL(this.config.mcpUrl),
          {
            requestInit: {
              headers: { Authorization: `Bearer ${this.config.apiKey}` },
            },
          }
        );
        await client.connect(transport);
        this.client = client;
        return client;
      })();
      this.connecting.catch(() => {
        // A failed connect must not poison later attempts.
        this.connecting = undefined;
      });
    }
    return await this.connecting;
  }

  async callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<ToolResult> {
    let client: Client;
    try {
      client = await this.connect();
    } catch (error) {
      return { ok: false, error: `KeeperHub MCP unreachable: ${message(error)}` };
    }

    try {
      const result = await client.callTool({ name, arguments: args });
      const text = firstText(result);
      const parsed = text === undefined ? undefined : tryParseJson(text);
      if (result.isError) {
        return { ok: false, error: text ?? `Tool ${name} failed`, data: parsed };
      }
      return { ok: true, data: parsed, text };
    } catch (error) {
      // A dropped session must not wedge the client: clear it so the next
      // call reconnects instead of reusing a transport the server forgot.
      this.client = undefined;
      this.connecting = undefined;
      return { ok: false, error: `KeeperHub call ${name} failed: ${message(error)}` };
    }
  }

  async close(): Promise<void> {
    await this.client?.close().catch(() => undefined);
    this.client = undefined;
    this.connecting = undefined;
  }
}

export type ToolResult =
  | { ok: true; data: unknown; text: string | undefined }
  | { ok: false; error: string; data?: unknown };

function firstText(result: unknown): string | undefined {
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return;
  }
  for (const block of content) {
    if (
      typeof block === "object" &&
      block !== null &&
      (block as { type?: unknown }).type === "text" &&
      typeof (block as { text?: unknown }).text === "string"
    ) {
      return (block as { text: string }).text;
    }
  }
  return;
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
