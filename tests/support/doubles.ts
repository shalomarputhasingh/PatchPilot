// TEST-ONLY doubles. They are not part of the application and are never used at runtime.
import { createServer, type Server } from "node:http";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
}
function body(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => resolve(d));
  });
}

/** Piston-shaped server that runs python3 locally. Honors run_timeout. */
export async function startFakePiston() {
  const calls: { files: string[]; stdin: string }[] = [];
  const server = createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/api/v2/execute") {
      res.statusCode = 404;
      return res.end("{}");
    }
    const payload = JSON.parse(await body(req)) as { files: { name: string; content: string }[]; stdin?: string; run_timeout?: number };
    calls.push({ files: payload.files.map((f) => f.name), stdin: payload.stdin ?? "" });
    const dir = mkdtempSync(path.join(tmpdir(), "pp-fake-"));
    for (const f of payload.files) writeFileSync(path.join(dir, f.name), f.content);
    const child = spawn("python3", [payload.files[0]!.name], { cwd: dir });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.stdin.end(payload.stdin ?? "");
    let killed = false;
    const t = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, payload.run_timeout ?? 3000);
    child.on("close", (code, signal) => {
      clearTimeout(t);
      rmSync(dir, { recursive: true, force: true });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ language: "python", version: "3", run: { stdout, stderr, output: stdout + stderr, code, signal, status: killed ? "TO" : null } }));
    });
  });
  const url = await listen(server);
  return { url, calls, close: () => new Promise<void>((r) => server.close(() => r())) };
}

/** Groq-shaped chat-completions server returning queued replies. */
export async function startFakeGroq() {
  const queue: (string | { status: number })[] = [];
  const requests: { model: string; messages: { role: string; content: string }[] }[] = [];
  const server = createServer(async (req, res) => {
    const parsed = JSON.parse(await body(req));
    requests.push(parsed);
    const next = queue.shift();
    res.setHeader("content-type", "application/json");
    if (next === undefined || typeof next !== "string") {
      res.statusCode = next?.status ?? 500;
      return res.end(JSON.stringify({ error: { message: "x" } }));
    }
    res.end(JSON.stringify({ id: "x", object: "chat.completion", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: next } }] }));
  });
  const url = await listen(server);
  return { url, queue, requests, close: () => new Promise<void>((r) => server.close(() => r())) };
}
