import type { Attempt, ExecutionResult, FinalStatus, TestRun, UserTestRun } from "./types";

export interface VerdictInput {
  mode: "full" | "preview";
  baseline?: ExecutionResult;
  baselineTests?: TestRun;
  baselineUserTests?: UserTestRun;
  /** The most recent attempt (the one whose result is being judged), if any. */
  attempt?: Attempt;
  hadAnyAttempt: boolean;
  /** Set when the workflow stopped early for an external reason (budget, provider). */
  aborted?: string;
}

export interface Verdict {
  status: FinalStatus;
  reason: string;
  reproduced: boolean;
}

export const failed = (t?: TestRun) => !!t?.outcomes.some((o) => o.status === "failed" || o.status === "error");
export const allPassed = (t?: TestRun) => !!t && t.ran && t.outcomes.length > 0 && t.outcomes.every((o) => o.status === "passed");
const crashed = (e?: ExecutionResult) => !!e && !e.providerError && (e.timedOut || (e.exitCode !== null && e.exitCode !== 0));
const clean = (e?: ExecutionResult) => !!e && !e.providerError && !e.timedOut && e.exitCode === 0;

/** True when this attempt applied and then failed some executed check — the trigger for a repair attempt. */
export function attemptFailedChecks(a: Attempt): boolean {
  if (a.patchStatus !== "applied") return false;
  if (a.repairedExecution && !a.repairedExecution.providerError && !clean(a.repairedExecution)) return true;
  if (failed(a.generatedTests)) return true;
  if (a.userTests?.ran && !a.userTests.passed) return true;
  return false;
}

/**
 * Deterministic final status. Groq is never consulted.
 *
 * FAILED                   patch never applied, OR the patched code crashed/timed out, OR any executed
 *                          generated/user test failed on the patched code.
 * BASELINE_NOT_REPRODUCED  patch applied and checks pass, but nothing failed on the ORIGINAL code
 *                          (clean exit, no failing generated test, no failing user test).
 * VERIFIED                 failure reproduced on the original (crash/timeout, failing generated test, or
 *                          failing user test), patch applied, patched code exits 0, every generated test
 *                          passed, and user tests (if supplied) passed.
 * PARTIALLY_VERIFIED       failure reproduced, patched code exits 0 and nothing failed, but required
 *                          evidence is missing (no generated tests ran, or some were not_run).
 * UNVERIFIED               nothing was executed (preview mode / sandbox error / aborted), or evidence
 *                          does not establish that the repair works.
 */
export function computeVerdict(i: VerdictInput): Verdict {
  const reproduced =
    crashed(i.baseline) || failed(i.baselineTests) || (!!i.baselineUserTests?.ran && !i.baselineUserTests.passed);
  const a = i.attempt;

  if (i.mode === "preview") {
    return { status: "UNVERIFIED", reason: "Preview mode: the sandbox is not configured, so nothing was executed. The patch is a proposal only.", reproduced: false };
  }
  if (!a || a.patchStatus !== "applied") {
    return {
      status: "FAILED",
      reason: i.hadAnyAttempt
        ? `The proposed patch could not be applied: ${a?.patchError ?? "unknown error"}.`
        : i.aborted ?? "No patch was produced.",
      reproduced,
    };
  }
  if (!a.repairedExecution || a.repairedExecution.providerError) {
    return { status: "UNVERIFIED", reason: `The patched code could not be executed: ${a.repairedExecution?.providerError ?? i.aborted ?? "no execution result"}.`, reproduced };
  }
  if (i.aborted && !a.generatedTests && !attemptFailedChecks(a)) {
    return { status: "UNVERIFIED", reason: `${i.aborted} Verification did not complete.`, reproduced };
  }
  if (attemptFailedChecks(a)) {
    const why: string[] = [];
    if (!clean(a.repairedExecution)) why.push(a.repairedExecution.timedOut ? "the patched code timed out" : `the patched code exited with ${a.repairedExecution.exitCode}`);
    const nFail = a.generatedTests?.outcomes.filter((o) => o.status === "failed" || o.status === "error").length ?? 0;
    if (nFail) why.push(`${nFail} generated regression test(s) failed (tests are AI-authored and may themselves be wrong)`);
    if (a.userTests?.ran && !a.userTests.passed) why.push("your supplied tests failed");
    return { status: "FAILED", reason: `Required verification failed: ${why.join("; ")}.`, reproduced };
  }
  if (!reproduced) {
    return {
      status: "BASELINE_NOT_REPRODUCED",
      reason: "The original code exited cleanly and no executed check failed against it, so the reported bug was not demonstrated. The patch did not break the executed checks, but its effect is unproven.",
      reproduced: false,
    };
  }
  const gen = a.generatedTests;
  const userOk = !a.userTests?.ran || a.userTests.passed;
  if (allPassed(gen) && userOk) {
    return { status: "VERIFIED", reason: "The failure was reproduced on the original code; the patched code exits cleanly and every executed regression check passed. This is evidence for these cases, not proof for all inputs.", reproduced };
  }
  if (!gen?.ran || gen.outcomes.length === 0) {
    return { status: "PARTIALLY_VERIFIED", reason: "The failure was reproduced and the patched code exits cleanly, but no regression tests ran to confirm the fix.", reproduced };
  }
  return { status: "PARTIALLY_VERIFIED", reason: "Failure reproduced and no executed check failed, but some regression tests were not run.", reproduced };
}
