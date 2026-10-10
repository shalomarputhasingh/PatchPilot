import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runWorkflow, runRetry, retryEligible } from "@/lib/engine";
import { createSession, type InternalSession } from "@/lib/store";
import type { DebugRequest } from "@/lib/types";
import { startFakeGroq, startFakePiston } from "./support/doubles";

let groq: Awaited<ReturnType<typeof startFakeGroq>>;
let piston: Awaited<ReturnType<typeof startFakePiston>>;
beforeAll(async () => {
  groq = await startFakeGroq();
  piston = await startFakePiston();
});
afterAll(async () => {
  await groq.close();
  await piston.close();
});
beforeEach(() => {
  process.env.GROQ_API_KEY = "test-key";
  process.env.GROQ_MODEL = "test-model";
  process.env.GROQ_BASE_URL = groq.url;
  process.env.SANDBOX_API_URL = piston.url;
  process.env.SANDBOX_RUN_TIMEOUT_MS = "3000";
  groq.queue.length = 0;
  groq.requests.length = 0;
});
afterEach(() => {
  delete process.env.SANDBOX_API_URL;
});

const SRC = "def calculate_discount(price, discount):\n    return price - price * discount\n\nprint(calculate_discount(100, 20))\n";
const req: DebugRequest = { source: SRC, bugReport: "Discount should be a percentage: (100, 20) should give 80, gives -1900." };
const diff = (newExpr: string) =>
  `--- a/solution.py\n+++ b/solution.py\n@@ -1,4 +1,4 @@\n def calculate_discount(price, discount):\n-    return price - price * discount\n+    return ${newExpr}\n \n print(calculate_discount(100, 20))\n`;
const tests = [
  { name: "20% off 100", function: "calculate_discount", args: [100, 20], kwargs: {}, expected: 80 },
  { name: "0% off", function: "calculate_discount", args: [50, 0], kwargs: {}, expected: 50 },
];
const reply = (unifiedDiff: string, regressionTests = tests) =>
  JSON.stringify({
    summary: "Discount treated as fraction", rootCause: "Missing /100", reasoning: "Divide by 100", unifiedDiff,
    affectedLines: [2], regressionTests, limitations: [], edgeCases: ["discount 0"],
  });

async function run(r: DebugRequest = req): Promise<InternalSession> {
  const s = createSession(r, process.env.SANDBOX_API_URL ? "full" : "preview")!;
  await runWorkflow(s);
  return s;
}

describe("engine", () => {
  it("VERIFIED on the canonical example, with real execution evidence", async () => {
    groq.queue.push(reply(diff("price - price * discount / 100")));
    const s = await run();
    expect(s.status).toBe("done");
    expect(s.baseline?.stdout.trim()).toBe("-1900");
    expect(s.attempts).toHaveLength(1);
    expect(s.attempts[0]!.repairedExecution?.stdout.trim()).toBe("80.0");
    expect(s.baselineTests?.outcomes.map((o) => o.status)).toEqual(["failed", "passed"]);
    expect(s.attempts[0]!.generatedTests?.outcomes.map((o) => o.status)).toEqual(["passed", "passed"]);
    expect(s.finalStatus).toBe("VERIFIED");
    expect(s.steps.every((st) => st.state === "completed")).toBe(true);
    expect(s.originalSource).toBe(SRC);
    // The prompt carried the real baseline output and fenced untrusted input.
    const prompt = groq.requests[0]!.messages.map((m) => m.content).join("\n");
    expect(prompt).toContain("-1900");
    expect(prompt).toContain("<source_file");
  });

  it("repairs after a failing first patch, within the cap", async () => {
    groq.queue.push(reply(diff("price - price * discount / 10")), reply(diff("price - price * discount / 100")));
    const s = await run();
    expect(s.attempts.map((a) => a.passed)).toEqual([false, true]);
    expect(s.repairAttemptsUsed).toBe(1);
    expect(s.finalStatus).toBe("VERIFIED");
    expect(groq.requests[1]!.messages.map((m) => m.content).join("\n")).toContain("failing_tests");
  });

  it("stops after two repairs and reports FAILED", async () => {
    groq.queue.push(reply(diff("price - 1")), reply(diff("price - 2")), reply(diff("price - 3")), reply(diff("price - 4")));
    const s = await run();
    expect(s.attempts).toHaveLength(3);
    expect(s.repairAttemptsUsed).toBe(2);
    expect(s.finalStatus).toBe("FAILED");
    expect(groq.requests).toHaveLength(3);
    expect(s.canRetry).toBe(false);
    expect(retryEligible(s)).toBe(false);
  });

  it("asks for one corrected patch when the diff does not apply", async () => {
    groq.queue.push(reply(diff("x").replace("price * discount\n+", "WRONG\n+")), reply(diff("price - price * discount / 100")));
    const s = await run();
    expect(s.attempts).toHaveLength(1);
    expect(s.finalStatus).toBe("VERIFIED");
    expect(s.notices.join()).toMatch(/rejected/);
  });

  it("FAILED when the corrected patch is also invalid", async () => {
    groq.queue.push(reply("not a diff"), reply("still not a diff"));
    const s = await run();
    expect(s.finalStatus).toBe("FAILED");
    expect(s.attempts[0]!.patchStatus).toBe("rejected");
    expect(s.steps.find((x) => x.id === "repaired")!.state).toBe("skipped");
  });

  it("BASELINE_NOT_REPRODUCED when the original already behaves", async () => {
    const good = SRC.replace("price * discount\n", "price * discount / 100\n");
    groq.queue.push(reply(`--- a/solution.py\n+++ b/solution.py\n@@ -1,4 +1,4 @@\n def calculate_discount(price, discount):\n-    return price - price * discount / 100\n+    return price * (1 - discount / 100)\n \n print(calculate_discount(100, 20))\n`));
    const s = await run({ ...req, source: good });
    expect(s.finalStatus).toBe("BASELINE_NOT_REPRODUCED");
    expect(s.reproduced).toBe(false);
  });

  it("surfaces malformed model output as a sanitized error after one re-ask", async () => {
    groq.queue.push("this is not json", '{"summary":1}');
    const s = await run();
    expect(s.status).toBe("error");
    expect(s.error?.code).toBe("GROQ_INVALID_RESPONSE");
    expect(groq.requests).toHaveLength(2);
    expect(s.steps.find((x) => x.id === "analysis")!.state).toBe("failed");
  });

  it("maps Groq HTTP errors", async () => {
    groq.queue.push({ status: 401 });
    const s = await run();
    expect(s.error?.code).toBe("GROQ_AUTH");
  });

  it("runs in labeled preview mode without a sandbox and never claims verification", async () => {
    delete process.env.SANDBOX_API_URL;
    groq.queue.push(reply(diff("price - price * discount / 100")));
    const s = await run();
    expect(s.mode).toBe("preview");
    expect(s.finalStatus).toBe("UNVERIFIED");
    expect(s.attempts[0]!.patchStatus).toBe("applied");
    expect(s.attempts[0]!.repairedExecution).toBeUndefined();
    expect(s.steps.find((x) => x.id === "repaired")!.state).toBe("skipped");
  });

  it("errors cleanly when the sandbox is unreachable", async () => {
    process.env.SANDBOX_API_URL = "http://127.0.0.1:1";
    const s = await run();
    expect(s.status).toBe("error");
    expect(s.error?.code).toBe("SANDBOX_ERROR");
    expect(groq.requests).toHaveLength(0);
  });

  it("runs user-supplied tests separately and counts them toward the verdict", async () => {
    groq.queue.push(reply(diff("price - price * discount / 100")));
    const userTests = "from solution import calculate_discount\nassert calculate_discount(200, 50) == 100\n";
    const s = await run({ ...req, userTests });
    expect(s.attempts[0]!.userTests).toMatchObject({ ran: true, passed: true });
    expect(s.baselineUserTests).toMatchObject({ ran: true, passed: false });
    expect(s.finalStatus).toBe("VERIFIED");
  });

  it("retry is refused when not eligible and the cap is enforced", async () => {
    groq.queue.push(reply(diff("price - price * discount / 100")));
    const s = await run();
    expect(retryEligible(s)).toBe(false);
    await runRetry(s).catch(() => {});
    expect(s.attempts).toHaveLength(1);
  });

  it("allows a manual retry after the repair call itself failed, then enforces the cap", async () => {
    groq.queue.push(reply(diff("price - 1")), { status: 500 }, { status: 500 }, reply(diff("price - price * discount / 100")));
    const s = await run();
    expect(s.finalStatus).toBe("FAILED");
    expect(s.canRetry).toBe(true);
    expect(retryEligible(s)).toBe(true);
    s.running = true;
    await runRetry(s);
    expect(s.finalStatus).toBe("VERIFIED");
    expect(s.attempts).toHaveLength(2);
    expect(s.repairAttemptsUsed).toBe(2); // the failed call consumed one of the two allowed repairs
    expect(retryEligible(s)).toBe(false);
  });
});
