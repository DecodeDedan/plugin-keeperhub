import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Load .env for the live integration tests.
 *
 * Node 24 reads env files natively, so this needs no dependency. The file is
 * optional on purpose: without it the live tests skip and the rest of the
 * suite still runs green, which is what lets a clone with no credentials
 * verify the plugin.
 */
const envPath = resolve(import.meta.dirname, "..", ".env");
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}
