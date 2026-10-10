import "server-only";
import { getConfig } from "../config";
import { PistonSandbox } from "./piston";
import type { SandboxAdapter } from "./types";

/** Returns the configured adapter, or null when no sandbox is configured. */
export function getSandbox(): SandboxAdapter | null {
  const { sandbox } = getConfig();
  if (!sandbox.configured) return null;
  switch (sandbox.provider) {
    case "piston":
      return new PistonSandbox(sandbox.url, sandbox.apiKey);
    default:
      throw new Error(`Unsupported SANDBOX_PROVIDER "${sandbox.provider}". Supported: piston.`);
  }
}
