import { LIMITS } from "../limits";
import type { ExecutionResult } from "../types";
import type { SandboxAdapter, SandboxRequest } from "./types";

export const RAPIDAPI_DEFAULT_URL = "https://sandboxapi.p.rapidapi.com";

/**
 * Adapter for SandboxAPI on RapidAPI (https://rapidapi.com/sandboxapidev/api/sandboxapi).
 *
 * Contract used (from the public RapidAPI listing):
 *   POST {base}/v1/execute   headers: X-RapidAPI-Key, X-RapidAPI-Host
 *   single file: { language: "python3", code, stdin, timeout }
 *   multi file:  { language: "python3", additional_files: <base64 ZIP>, run_script, stdin, timeout }
 *   -> { status, stdout, stderr, exit_code, exit_signal, execution_time_ms, wall_time_ms, ... }
 *   status: completed | wrong_answer | timeout | compilation_error | runtime_error | memory_limit | internal_error
 *
 * `timeout` is whole CPU seconds, so the requested timeout is rounded up.
 */
export class RapidApiSandbox implements SandboxAdapter {
  readonly name = "rapidapi";
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

    if (!req.files.length) return fail("No files to execute.");

    const timeoutSec = Math.max(1, Math.ceil(req.timeoutMs / 1000));
    const payload: Record<string, unknown> = {
      language: "python3",
      stdin: req.stdin ?? "",
      timeout: timeoutSec,
      wall_time_limit: timeoutSec,
    };
    if (req.files.length === 1) {
      payload.code = req.files[0]!.content;
    } else {
      payload.additional_files = zipBase64(req.files);
      payload.run_script = `python3 ${shellQuote(req.files[0]!.name)}`;
    }

    let host: string;
    try {
      host = new URL(this.baseUrl).host;
    } catch {
      return fail("SANDBOX_API_URL is not a valid URL.");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs + 15_000);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/v1/execute`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-rapidapi-key": this.apiKey,
          "x-rapidapi-host": host,
        },
        signal: controller.signal,
        body: JSON.stringify(payload),
      });
    } catch (e) {
      clearTimeout(timer);
      const aborted = e instanceof Error && e.name === "AbortError";
      return fail(aborted ? "Sandbox request timed out." : "Sandbox is unreachable.");
    }
    clearTimeout(timer);

    if (res.status === 429) return fail("Sandbox rate limit reached. Try again shortly.");
    if (res.status === 401 || res.status === 403) {
      return fail(`Sandbox rejected the credentials (HTTP ${res.status}). Check your RapidAPI key and subscription.`);
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return fail(res.ok ? "Sandbox returned a response that is not valid JSON." : `Sandbox returned HTTP ${res.status}.`);
    }
    const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;

    if (!res.ok) {
      const err = b.error as { message?: unknown } | undefined;
      const msg = typeof err?.message === "string" ? err.message : typeof b.message === "string" ? b.message : "";
      return fail(`Sandbox returned HTTP ${res.status}${msg ? `: ${msg.slice(0, 200)}` : ""}.`);
    }

    const status = typeof b.status === "string" ? b.status : "";
    if (!status && typeof b.exit_code !== "number") return fail("Sandbox response had an unexpected shape.");
    if (status === "internal_error") return fail("Sandbox reported an internal error.");

    let stdout = str(b.stdout);
    let stderr = str(b.stderr);
    if (status === "compilation_error" && !stderr) stderr = str(b.compile_output);
    let truncated = false;
    if (stdout.length > LIMITS.maxOutputChars) {
      stdout = stdout.slice(0, LIMITS.maxOutputChars) + "\n…[output truncated]";
      truncated = true;
    }
    if (stderr.length > LIMITS.maxOutputChars) {
      stderr = stderr.slice(0, LIMITS.maxOutputChars) + "\n…[output truncated]";
      truncated = true;
    }

    const timedOut = status === "timeout";
    const killed = timedOut || status === "memory_limit";
    const sigNum = typeof b.exit_signal === "number" && b.exit_signal > 0 ? b.exit_signal : null;
    const exitCode = typeof b.exit_code === "number" ? b.exit_code : null;

    return {
      stdout,
      stderr: status === "memory_limit" && !stderr ? "MemoryError: memory limit exceeded" : stderr,
      // A timeout or memory kill must never be presented as a clean exit.
      exitCode: killed && (exitCode === 0 || exitCode === null) ? 137 : exitCode,
      signal: sigNum === null ? null : (SIGNALS[sigNum] ?? `SIG${sigNum}`),
      timedOut,
      durationMs: Date.now() - started,
      truncated,
    };
  }
}

const SIGNALS: Record<number, string> = { 6: "SIGABRT", 9: "SIGKILL", 11: "SIGSEGV", 15: "SIGTERM" };
const str = (v: unknown) => (typeof v === "string" ? v : "");
const shellQuote = (s: string) => "'" + s.split("'").join("'\\''") + "'";

/** Minimal "stored" (uncompressed) ZIP writer, returned base64-encoded. */
export function zipBase64(files: { name: string; content: string }[]): string {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const data = Buffer.from(f.content, "utf8");
    const crc = crc32(data);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4); // version needed
    lh.writeUInt16LE(0x0800, 6); // UTF-8 names
    lh.writeUInt16LE(0, 8); // stored
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    locals.push(lh, name, data);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);

    offset += lh.length + name.length + data.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]).toString("base64");
}

let crcTable: Uint32Array | undefined;
function crc32(buf: Buffer): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
