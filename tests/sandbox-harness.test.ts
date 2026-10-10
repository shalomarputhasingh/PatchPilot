import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PistonSandbox } from "@/lib/sandbox/piston";
import { buildHarnessFiles, parseHarnessOutput } from "@/lib/harness";
import type { RegressionTest } from "@/lib/types";
import { startFakePiston } from "./support/doubles";

let piston: Awaited<ReturnType<typeof startFakePiston>>;
let sb: PistonSandbox;
beforeAll(async () => {
  piston = await startFakePiston();
  sb = new PistonSandbox(piston.url, "");
});
afterAll(() => piston.close());

const tests: RegressionTest[] = [
  { name: "20% of 100", function: "calculate_discount", args: [100, 20], kwargs: {}, expected: 80 },
  { name: "zero", function: "calculate_discount", args: [50, 0], kwargs: {}, expected: 50 },
  { name: "missing fn", function: "nope", args: [], kwargs: {}, expected: 1 },
];
const BUGGY = "def calculate_discount(price, discount):\n    return price - price * discount\n\nprint(calculate_discount(100, 20))\n";
const FIXED = BUGGY.replace("price * discount\n", "price * discount / 100\n");

describe("PistonSandbox adapter", () => {
  it("returns stdout / exit code", async () => {
    const r = await sb.executePython({ files: [{ name: "solution.py", content: BUGGY }], timeoutMs: 5000 });
    expect(r.stdout.trim()).toBe("-1900");
    expect(r.exitCode).toBe(0);
  });
  it("reports stderr and non-zero exit", async () => {
    const r = await sb.executePython({ files: [{ name: "solution.py", content: "1/0" }], timeoutMs: 5000 });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("ZeroDivisionError");
  });
  it("reports timeouts", async () => {
    const r = await sb.executePython({ files: [{ name: "solution.py", content: "while True: pass" }], timeoutMs: 1000 });
    expect(r.timedOut).toBe(true);
  });
  it("normalizes transport failures instead of throwing", async () => {
    const r = await new PistonSandbox("http://127.0.0.1:1", "").executePython({ files: [{ name: "a.py", content: "" }], timeoutMs: 1000 });
    expect(r.providerError).toBeTruthy();
  });
  it("normalizes HTTP errors and bad JSON", async () => {
    const r429 = await new PistonSandbox("http://x", "", async () => new Response("", { status: 429 })).executePython({ files: [], timeoutMs: 1000 });
    expect(r429.providerError).toMatch(/rate limit/i);
    const bad = await new PistonSandbox("http://x", "", async () => new Response("<html>", { status: 200 })).executePython({ files: [], timeoutMs: 1000 });
    expect(bad.providerError).toMatch(/not valid JSON/);
    const shape = await new PistonSandbox("http://x", "", async () => new Response("{}", { status: 200 })).executePython({ files: [], timeoutMs: 1000 });
    expect(shape.providerError).toMatch(/unexpected shape/);
  });
  it("sends bearer auth only when a key is configured", async () => {
    let auth: string | null = null;
    const f: typeof fetch = async (_u, init) => {
      auth = new Headers(init?.headers).get("authorization");
      return new Response(JSON.stringify({ run: { stdout: "", stderr: "", code: 0 } }));
    };
    await new PistonSandbox("http://x", "k", f).executePython({ files: [], timeoutMs: 1000 });
    expect(auth).toBe("Bearer k");
  });
});

describe("test harness", () => {
  it("fails the bug on the original and passes on the fix; unknown functions error; none are fabricated", async () => {
    const before = parseHarnessOutput(tests, await sb.executePython({ files: buildHarnessFiles(BUGGY, tests), timeoutMs: 5000 }));
    expect(before.outcomes.map((o) => o.status)).toEqual(["failed", "passed", "error"]);
    const after = parseHarnessOutput(tests, await sb.executePython({ files: buildHarnessFiles(FIXED, tests), timeoutMs: 5000 }));
    expect(after.outcomes.map((o) => o.status)).toEqual(["passed", "passed", "error"]);
  });
  it("treats a crashing import as errors and a timeout as not_run", async () => {
    const crash = parseHarnessOutput(tests, await sb.executePython({ files: buildHarnessFiles("raise SystemExit(3)", tests), timeoutMs: 5000 }));
    expect(crash.outcomes.every((o) => o.status === "error")).toBe(true);
    const hang = parseHarnessOutput(tests, await sb.executePython({ files: buildHarnessFiles("while True: pass", tests), timeoutMs: 1000 }));
    expect(hang.ran).toBe(false);
    expect(hang.outcomes.every((o) => o.status === "not_run")).toBe(true);
  });
  it("cannot be spoofed by program output without the marker line being the real one", async () => {
    // A program printing a fake result marker during import is swallowed by redirect_stdout.
    const evil = 'print("__PATCHPILOT_RESULT__" + \'{"results":[]}\')\ndef calculate_discount(p,d):\n    return 0\n';
    const r = parseHarnessOutput(tests, await sb.executePython({ files: buildHarnessFiles(evil, tests), timeoutMs: 5000 }));
    expect(r.outcomes[0]!.status).toBe("failed");
  });
});
