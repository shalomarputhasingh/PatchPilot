import { describe, expect, it } from "vitest";
import { RapidApiSandbox } from "@/lib/sandbox/rapidapi";

function stub(body: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { calls, sb: new RapidApiSandbox("https://sandboxapi.p.rapidapi.com", "KEY", fetchImpl) };
}

describe("RapidApiSandbox adapter", () => {
  it("sends a single file as `code` with RapidAPI headers", async () => {
    const { calls, sb } = stub({ status: "completed", stdout: "hi\n", stderr: "", exit_code: 0 });
    const r = await sb.executePython({ files: [{ name: "solution.py", content: "print('hi')" }], timeoutMs: 2500 });
    expect(r.stdout).toBe("hi\n");
    expect(r.exitCode).toBe(0);
    expect(calls[0]!.url).toBe("https://sandboxapi.p.rapidapi.com/v1/execute");
    const h = calls[0]!.init.headers as Record<string, string>;
    expect(h["x-rapidapi-key"]).toBe("KEY");
    expect(h["x-rapidapi-host"]).toBe("sandboxapi.p.rapidapi.com");
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body).toMatchObject({ language: "python3", code: "print('hi')", timeout: 3 });
  });
  it("sends multiple files as a base64 ZIP with a run_script", async () => {
    const { calls, sb } = stub({ status: "completed", stdout: "", stderr: "", exit_code: 0 });
    await sb.executePython({ files: [{ name: "main.py", content: "import a" }, { name: "a.py", content: "x=1" }], timeoutMs: 1000 });
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body.run_script).toBe("python3 'main.py'");
    expect(Buffer.from(body.additional_files, "base64").subarray(0, 4).toString("hex")).toBe("504b0304");
  });
  it("maps timeouts and runtime errors", async () => {
    const t = await stub({ status: "timeout", stdout: "", stderr: "", exit_code: 0, exit_signal: 9 }).sb.executePython({ files: [{ name: "a.py", content: "" }], timeoutMs: 1000 });
    expect(t.timedOut).toBe(true);
    expect(t.exitCode).not.toBe(0);
    const e = await stub({ status: "runtime_error", stdout: "", stderr: "ZeroDivisionError", exit_code: 1 }).sb.executePython({ files: [{ name: "a.py", content: "" }], timeoutMs: 1000 });
    expect(e.exitCode).toBe(1);
    expect(e.stderr).toContain("ZeroDivisionError");
  });
  it("reports provider errors instead of throwing", async () => {
    const r = await stub({ message: "You are not subscribed" }, 403).sb.executePython({ files: [{ name: "a.py", content: "" }], timeoutMs: 1000 });
    expect(r.providerError).toContain("credentials");
  });
});
