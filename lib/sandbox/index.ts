import "server-only";
import { getConfig } from "../config";
import { PistonSandbox } from "./piston";
import { RapidApiSandbox, RAPIDAPI_DEFAULT_URL } from "./rapidapi";
import type { SandboxAdapter } from "./types";

/** Returns the configured adapter, or null when no sandbox is configured. */
export function getSandbox(): SandboxAdapter | null {
  const { sandbox } = getConfig();
  if (!sandbox.configured) return null;
  switch (sandbox.provider) {
    case "piston":
      return new PistonSandbox(sandbox.url, sandbox.apiKey);
    case "rapidapi":
      return new RapidApiSandbox(sandbox.url || RAPIDAPI_DEFAULT_URL, sandbox.apiKey);
    default:
      throw new Error(`Unsupported SANDBOX_PROVIDER "${sandbox.provider}". Supported: piston, rapidapi.`);
  }
}
