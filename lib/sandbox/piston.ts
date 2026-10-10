import { LIMITS } from "../limits";
import type { ExecutionResult } from "../types";
import type { SandboxAdapter, SandboxRequest } from "./types";

/**
 * Adapter for Piston-compatible execution APIs (https://github.com/engineer-man/piston).
 *
 * Contract used (from the public Piston v2 docs):
 *   POST {base}/api/v2/execute
 *   { language, version, files:[{name,content}], stdin, run_timeout, compile_timeout }
 *   -> { language, version, run:{ stdout, stderr, output, code, signal, status? }, compile?:{...} }
 *
 * NOTE: not verified against a live deployment in the development environment;
 * the test suite exercises it against a local test double only. Isolation, resource
 * limits and network restrictions are enforced by the Piston deployment, not by this
 * adapter — operate it with those enabled before accepting untrusted code.
 */
export class PistonSandbox implements SandboxAdapter {
  readonly name = "piston";
  readonly capabilities = { multiFile: true, stdin: true };

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async executePython(req: SandboxRequest): Promise<ExecutionResult> {
    const started = Date.now();
    const fail = (providerError: string): ExecutionResult => ({
      stdout: "",
      stderr: "",
      exitCode: null,
      timedOut: false,
      durationMs: Date.now() - started,
      truncated: false,
      providerError,
    });

    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;

    const controller = new AbortController();
    // Transport timeout: program timeout + headroom for queueing/startup.
    const timer = setTimeout(() => controller.abort(), req.timeoutMs + 15_000);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/api/v2/execute`, {
        method: "POST",
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          language: "python",
          version: "*",
          files: req.files,
          stdin: req.stdin ?? "",
          run_timeout: req.timeoutMs,
          compile_timeout: 10_000,
        }),
      });
    } catch (e) {
      clearTimeout(timer);
      const aborted = e instanceof Error && e.name === "AbortError";
      return fail(aborted ? "Sandbox request timed out." : "Sandbox is unreachable.");
    }
    clearTimeout(timer);

    if (res.status === 429) return fail("Sandbox rate limit reached. Try again shortly.");
    if (res.status === 401 || res.status === 403) return fail("Sandbox rejected the credentials (HTTP " + res.status + ").");
    if (!res.ok) return fail(`Sandbox returned HTTP ${res.status}.`);

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return fail("Sandbox returned a response that is not valid JSON.");
    }

    const run = pick(body, "run");
    if (!run) {
      const msg = typeof (body as { message?: unknown })?.message === "string" ? `: ${(body as { message: string }).message}` : "";
      return fail(`Sandbox response had an unexpected shape${msg.slice(0, 200)}.`);
    }
    const compile = pick(body, "compile");

    const compileFailed = compile && typeof compile.code === "number" && compile.code !== 0;
    const src = compileFailed ? compile : run;
    let stdout = str(src.stdout);
    let stderr = str(src.stderr);
    let truncated = false;
    if (stdout.length > LIMITS.maxOutputChars) {
      stdout = stdout.slice(0, LIMITS.maxOutputChars) + "\n…[output truncated]";
      truncated = true;
    }
    if (stderr.length > LIMITS.maxOutputChars) {
      stderr = stderr.slice(0, LIMITS.maxOutputChars) + "\n…[output truncated]";
      truncated = true;
    }
    const durationMs = Date.now() - started;
    const signal = typeof src.signal === "string" ? src.signal : null;
    const status = typeof src.status === "string" ? src.status : null;
    // Piston v3 reports status "TO" for timeouts; older builds only report SIGKILL.
    const timedOut = status === "TO" || (signal === "SIGKILL" && !status && durationMs >= req.timeoutMs * 0.9);

    return {
      stdout,
      stderr,
      exitCode: typeof src.code === "number" ? src.code : null,
      signal,
      timedOut,
      durationMs,
      truncated,
    };
  }
}

function pick(obj: unknown, key: string): Record<string, unknown> | null {
  if (obj && typeof obj === "object" && key in obj) {
    const v = (obj as Record<string, unknown>)[key];
    if (v && typeof v === "object") return v as Record<string, unknown>;
  }
  return null;
}
const str = (v: unknown) => (typeof v === "string" ? v : "");
