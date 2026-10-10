import type { ExecutionResult } from "../types";

export interface SandboxFile {
  name: string;
  content: string;
}

export interface SandboxRequest {
  /** First file is the entrypoint. Additional files are importable modules. */
  files: SandboxFile[];
  stdin?: string;
  timeoutMs: number;
}

/**
 * Provider-agnostic sandbox contract. Implementations must never throw for
 * program failures (non-zero exit, timeout); those are reported in the result.
 * Provider/transport failures are reported via `providerError` on the result.
 */
export interface SandboxAdapter {
  readonly name: string;
  /** Capabilities of the provider as documented — used to degrade gracefully. */
  readonly capabilities: { multiFile: boolean; stdin: boolean };
  executePython(req: SandboxRequest): Promise<ExecutionResult>;
}

export class SandboxNotConfiguredError extends Error {}
