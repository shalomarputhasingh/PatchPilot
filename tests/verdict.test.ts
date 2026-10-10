import { describe, expect, it } from "vitest";
import { computeVerdict } from "@/lib/verdict";
import type { Attempt, ExecutionResult, TestRun } from "@/lib/types";

const ex = (o: Partial<ExecutionResult> = {}): ExecutionResult => ({ stdout: "", stderr: "", exitCode: 0, timedOut: false, durationMs: 1, truncated: false, ...o });
const run = (...s: ("passed" | "failed" | "not_run")[]): TestRun => ({ ran: true, outcomes: s.map((status, i) => ({ name: `t${i}`, status })) });
const attempt = (o: Partial<Attempt> = {}): Attempt => ({
  index: 0, kind: "initial", reasoning: "", rawDiff: "", patchStatus: "applied", passed: false, startedAt: 0,
  repairedExecution: ex(), generatedTests: run("passed"), ...o,
});
const base = { mode: "full" as const, hadAnyAttempt: true };

describe("computeVerdict", () => {
  it("VERIFIED when reproduced by a failing generated test and everything passes after", () => {
    const v = computeVerdict({ ...base, baseline: ex(), baselineTests: run("failed", "passed"), attempt: attempt({ generatedTests: run("passed", "passed") }) });
    expect(v.status).toBe("VERIFIED");
  });
  it("VERIFIED when reproduced by a crash", () => {
    expect(computeVerdict({ ...base, baseline: ex({ exitCode: 1 }), attempt: attempt() }).status).toBe("VERIFIED");
  });
  it("BASELINE_NOT_REPRODUCED when nothing failed on the original", () => {
    expect(computeVerdict({ ...base, baseline: ex(), baselineTests: run("passed"), attempt: attempt() }).status).toBe("BASELINE_NOT_REPRODUCED");
  });
  it("FAILED when patched code fails a test", () => {
    expect(computeVerdict({ ...base, baseline: ex({ exitCode: 1 }), attempt: attempt({ generatedTests: run("passed", "failed") }) }).status).toBe("FAILED");
  });
  it("FAILED when the patch never applied", () => {
    expect(computeVerdict({ ...base, attempt: attempt({ patchStatus: "rejected", patchError: "bad" }) }).status).toBe("FAILED");
  });
  it("PARTIALLY_VERIFIED when reproduced but no tests ran", () => {
    expect(computeVerdict({ ...base, baseline: ex({ exitCode: 1 }), attempt: attempt({ generatedTests: { ran: false, outcomes: [] } }) }).status).toBe("PARTIALLY_VERIFIED");
  });
  it("PARTIALLY_VERIFIED when some tests were not run", () => {
    expect(computeVerdict({ ...base, baseline: ex(), baselineTests: run("failed"), attempt: attempt({ generatedTests: run("passed", "not_run") }) }).status).toBe("PARTIALLY_VERIFIED");
  });
  it("UNVERIFIED in preview mode and on sandbox errors", () => {
    expect(computeVerdict({ ...base, mode: "preview", attempt: attempt() }).status).toBe("UNVERIFIED");
    expect(computeVerdict({ ...base, attempt: attempt({ repairedExecution: ex({ providerError: "down" }) }) }).status).toBe("UNVERIFIED");
  });
  it("UNVERIFIED when aborted before tests ran", () => {
    expect(computeVerdict({ ...base, aborted: "Stopped: budget.", attempt: attempt({ generatedTests: undefined }) }).status).toBe("UNVERIFIED");
  });
});
