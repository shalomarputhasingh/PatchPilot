import "server-only";
import { getConfig } from "./config";
import { analyze, repair, ModelError } from "./groq";
import { buildHarnessFiles, parseHarnessOutput, MODULE_FILENAME } from "./harness";
import { LIMITS } from "./limits";
import { applyPatch } from "./patch";
import { getSandbox } from "./sandbox";
import type { SandboxAdapter } from "./sandbox/types";
import type { InternalSession } from "./store";
import type { Attempt, ExecutionResult, RegressionTest, StepId, StepState, TestRun, UserTestRun } from "./types";
import { attemptFailedChecks, computeVerdict } from "./verdict";

class BudgetError extends Error {}
class WorkflowError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

const stepIndex = (s: InternalSession, id: StepId) => s.steps.findIndex((x) => x.id === id);

function setStep(s: InternalSession, id: StepId, state: StepState, detail?: string) {
  const step = s.steps[stepIndex(s, id)];
  if (!step) return;
  const now = Date.now();
  if (state === "running") {
    step.startedAt = now;
    step.durationMs = undefined;
    s.currentStep = id;
  } else if (step.startedAt && (state === "completed" || state === "failed")) {
    step.durationMs = now - step.startedAt;
  }
  step.state = state;
  step.detail = detail;
}

const remaining = (s: InternalSession) => s.deadline - Date.now();

async function exec(s: InternalSession, sb: SandboxAdapter, files: { name: string; content: string }[], stdin?: string): Promise<ExecutionResult> {
  const left = remaining(s);
  if (left < 3_000) throw new BudgetError("Session time budget exhausted.");
  const timeoutMs = Math.min(getConfig().sandbox.runTimeoutMs, Math.max(1_000, left - 2_000));
  return sb.executePython({ files, stdin, timeoutMs });
}

function checkBudget(s: InternalSession) {
  if (remaining(s) < 5_000) throw new BudgetError("Session time budget exhausted.");
}

const crashedOrTimedOut = (e: ExecutionResult) => e.timedOut || (e.exitCode !== null && e.exitCode !== 0);

function describeExec(e: ExecutionResult): string {
  if (e.providerError) return `sandbox error: ${e.providerError}`;
  if (e.timedOut) return "timed out";
  return `exit code ${e.exitCode}`;
}

/** Entry point: runs the full workflow. Never throws; failures are recorded on the session. */
export async function runWorkflow(s: InternalSession): Promise<void> {
  s.deadline = Date.now() + getConfig().sessionBudgetMs;
  const sb = s.mode === "full" ? getSandbox() : null;
  try {
    const req = s.request;
    setStep(s, "input", "completed", "Request validated");

    let baseline: ExecutionResult | undefined;
    if (sb) {
      setStep(s, "baseline", "running");
      baseline = await exec(s, sb, [{ name: MODULE_FILENAME, content: req.source }], req.stdin);
      s.baseline = baseline;
      if (baseline.providerError) throw new WorkflowError("SANDBOX_ERROR", baseline.providerError);
      setStep(s, "baseline", "completed", describeExec(baseline));
    } else {
      setStep(s, "baseline", "skipped", "Sandbox not configured (preview mode)");
      s.notices.push("Preview mode: no sandbox is configured, so no code was executed and nothing is verified.");
    }

    checkBudget(s);
    setStep(s, "analysis", "running", "Asking Groq");
    const model = await analyze(req, baseline);
    s.diagnosis = {
      summary: model.summary,
      rootCause: model.rootCause,
      reasoning: model.reasoning,
      affectedLines: model.affectedLines,
      limitations: model.limitations,
      edgeCases: model.edgeCases,
    };
    s.regressionTests = dedupeTests(model.regressionTests as RegressionTest[]);
    setStep(s, "analysis", "completed", baseline && !crashedOrTimedOut(baseline) ? "Baseline ran cleanly; diagnosis relies on the report" : "Diagnosis received");
    setStep(s, "patch", "completed", `${model.unifiedDiff.split("\n").length} diff lines, ${s.regressionTests.length} regression test(s) proposed`);

    await safeAttempt(s, sb, 0, "initial", model.unifiedDiff, model.reasoning);
    if (sb) await repairLoop(s, sb);
    finalize(s);
  } catch (e) {
    fail(s, e);
  } finally {
    s.running = false;
  }
}

/** Continue repairing after the loop stopped early. Enforces the attempt cap server-side. */
export async function runRetry(s: InternalSession): Promise<void> {
  s.deadline = Date.now() + getConfig().sessionBudgetMs;
  try {
    const sb = getSandbox();
    if (!sb) throw new WorkflowError("SANDBOX_NOT_CONFIGURED", "Sandbox is not configured.");
    s.finalStatus = undefined;
    s.finalReason = undefined;
    s.status = "running";
    await repairLoop(s, sb);
    finalize(s);
  } catch (e) {
    fail(s, e);
  } finally {
    s.running = false;
  }
}

export function retryEligible(s: InternalSession): boolean {
  if (s.running || s.status !== "done" || s.mode !== "full") return false;
  if (s.repairAttemptsUsed >= LIMITS.maxRepairAttempts) return false;
  const last = lastApplied(s);
  return !!last && attemptFailedChecks(last) && last === s.attempts[s.attempts.length - 1];
}

const lastApplied = (s: InternalSession) => [...s.attempts].reverse().find((a) => a.patchStatus === "applied");

function dedupeTests(tests: RegressionTest[]): RegressionTest[] {
  const seen = new Set<string>();
  return tests
    .filter((t) => "expected" in t && t.expected !== undefined)
    .filter((t) => {
      if (seen.has(t.name)) return false;
      seen.add(t.name);
      return true;
    })
    .slice(0, LIMITS.maxGeneratedTests);
}

async function repairLoop(s: InternalSession, sb: SandboxAdapter): Promise<void> {
  try {
    for (;;) {
      const last = s.attempts[s.attempts.length - 1];
      if (!last || last.patchStatus !== "applied" || !attemptFailedChecks(last)) return;
      if (last.repairedExecution?.providerError) return; // sandbox trouble: stop, do not burn attempts
      if (s.repairAttemptsUsed >= LIMITS.maxRepairAttempts) return;
      checkBudget(s);

      s.repairAttemptsUsed++; // counted before the await so a concurrent caller cannot exceed the cap
      const failing = [
        ...(last.generatedTests?.outcomes ?? [])
          .filter((o) => o.status === "failed" || o.status === "error")
          .map((o) => ({ name: o.name, message: o.message })),
        ...(last.userTests?.ran && !last.userTests.passed ? [{ name: "user-supplied tests", message: last.userTests.execution?.stderr.slice(-800) }] : []),
      ];
      const problem = last.repairedExecution && crashedOrTimedOut(last.repairedExecution)
        ? `The patched program ${describeExec(last.repairedExecution)}.`
        : "The patched program ran but regression checks failed.";
      setStep(s, "analysis", "running", `Repair attempt ${s.repairAttemptsUsed}/${LIMITS.maxRepairAttempts}: asking Groq`);
      for (const id of ["patch", "validate", "repaired", "tests", "final"] as StepId[]) setStep(s, id, "pending");
      let next;
      try {
        next = await repair({ req: s.request, previousDiff: last.diff ?? last.rawDiff, problem, failingTests: failing, repaired: last.repairedExecution });
      } catch (e) {
        setStep(s, "analysis", "failed", e instanceof ModelError ? e.message : "Repair request failed");
        s.notices.push(e instanceof ModelError ? `Repair attempt stopped: ${e.message}` : "Repair attempt stopped.");
        return;
      }
      setStep(s, "analysis", "completed", `Repair attempt ${s.repairAttemptsUsed} diagnosis received`);
      setStep(s, "patch", "completed", "Revised patch received");
      await safeAttempt(s, sb, s.repairAttemptsUsed, "repair", next.unifiedDiff, next.reasoning);
    }
  } catch (e) {
    if (e instanceof BudgetError) {
      s.notices.push("Stopped: the session time budget was exhausted.");
      return;
    }
    throw e;
  }
}

/** Runs an attempt; a budget overrun marks the in-flight step failed and ends the workflow gracefully. */
async function safeAttempt(s: InternalSession, sb: SandboxAdapter | null, index: number, kind: "initial" | "repair", diff: string, reasoning: string) {
  try {
    await runAttempt(s, sb, index, kind, diff, reasoning);
  } catch (e) {
    if (!(e instanceof BudgetError)) throw e;
    for (const step of s.steps) if (step.state === "running") setStep(s, step.id, "failed", e.message);
    s.notices.push("Stopped: the session time budget was exhausted.");
  }
}

async function runAttempt(
  s: InternalSession,
  sb: SandboxAdapter | null,
  index: number,
  kind: "initial" | "repair",
  rawDiff: string,
  reasoning: string,
): Promise<void> {
  const attempt: Attempt = { index, kind, reasoning, rawDiff, patchStatus: "rejected", passed: false, startedAt: Date.now() };
  s.attempts.push(attempt);
  try {
    // --- validate -------------------------------------------------------------------------
    setStep(s, "validate", "running");
    let result = applyPatch(s.originalSource, rawDiff);
    if (!result.ok) {
      s.notices.push(`Attempt ${index}: patch rejected (${result.error}); requesting one corrected patch.`);
      checkBudget(s);
      try {
        const fixed = await repair({
          req: s.request,
          previousDiff: rawDiff,
          problem: `The patch could not be applied: ${result.error}`,
          failingTests: [],
        });
        attempt.rawDiff = fixed.unifiedDiff;
        attempt.reasoning = fixed.reasoning;
        result = applyPatch(s.originalSource, fixed.unifiedDiff);
      } catch (e) {
        if (e instanceof BudgetError) throw e;
        // fall through with the original rejection
      }
    }
    if (!result.ok) {
      attempt.patchError = result.error;
      setStep(s, "validate", "failed", result.error);
      for (const id of ["repaired", "tests"] as StepId[]) setStep(s, id, "skipped", "Patch was not applied");
      return;
    }
    attempt.patchStatus = "applied";
    attempt.repairedSource = result.newSource;
    attempt.diff = result.diff;
    attempt.added = result.added;
    attempt.removed = result.removed;
    setStep(s, "validate", "completed", `Applied to a copy: +${result.added} −${result.removed}`);

    if (!sb) {
      setStep(s, "repaired", "skipped", "Preview mode");
      setStep(s, "tests", "skipped", "Preview mode");
      return;
    }

    // --- repaired execution ---------------------------------------------------------------
    setStep(s, "repaired", "running");
    const repaired = await exec(s, sb, [{ name: MODULE_FILENAME, content: result.newSource }], s.request.stdin);
    attempt.repairedExecution = repaired;
    if (repaired.providerError) {
      setStep(s, "repaired", "failed", describeExec(repaired));
      setStep(s, "tests", "skipped", "Sandbox error");
      return;
    }
    setStep(s, "repaired", crashedOrTimedOut(repaired) ? "failed" : "completed", describeExec(repaired));

    // --- tests ----------------------------------------------------------------------------
    setStep(s, "tests", "running");
    if (index === 0) {
      // Reproduction evidence: the same checks, run once against the ORIGINAL source.
      if (s.regressionTests.length) s.baselineTests = await runGeneratedTests(s, sb, s.originalSource);
      if (s.request.userTests?.trim()) s.baselineUserTests = await runUserTests(s, sb, s.originalSource);
    }
    attempt.generatedTests = s.regressionTests.length
      ? await runGeneratedTests(s, sb, result.newSource)
      : { ran: false, outcomes: [], note: "No regression tests were proposed (the file may have no testable function)." };
    if (s.request.userTests?.trim()) attempt.userTests = await runUserTests(s, sb, result.newSource);

    const gen = attempt.generatedTests;
    const nPass = gen.outcomes.filter((o) => o.status === "passed").length;
    attempt.passed = !attemptFailedChecks(attempt) && !repaired.providerError;
    setStep(
      s,
      "tests",
      attemptFailedChecks(attempt) ? "failed" : "completed",
      gen.outcomes.length ? `${nPass}/${gen.outcomes.length} generated tests passed` : "No generated tests ran",
    );
  } finally {
    attempt.durationMs = Date.now() - attempt.startedAt;
  }
}

async function runGeneratedTests(s: InternalSession, sb: SandboxAdapter, source: string): Promise<TestRun> {
  const execution = await exec(s, sb, buildHarnessFiles(source, s.regressionTests));
  return parseHarnessOutput(s.regressionTests, execution);
}

async function runUserTests(s: InternalSession, sb: SandboxAdapter, source: string): Promise<UserTestRun> {
  const execution = await exec(s, sb, [
    { name: "user_tests.py", content: s.request.userTests ?? "" },
    { name: MODULE_FILENAME, content: source },
  ]);
  if (execution.providerError) return { ran: false, passed: false, execution, note: execution.providerError };
  return { ran: true, passed: execution.exitCode === 0 && !execution.timedOut, execution };
}

function finalize(s: InternalSession) {
  const attempt = lastApplied(s) ?? s.attempts[s.attempts.length - 1];
  const verdict = computeVerdict({
    mode: s.mode,
    baseline: s.baseline,
    baselineTests: s.baselineTests,
    baselineUserTests: s.baselineUserTests,
    attempt,
    hadAnyAttempt: s.attempts.length > 0,
    aborted: s.notices.find((n) => n.startsWith("Stopped")),
  });
  s.finalStatus = verdict.status;
  s.finalReason = verdict.reason;
  s.reproduced = verdict.reproduced;
  s.status = "done";
  s.currentStep = "final";
  setStep(s, "final", verdict.status === "FAILED" ? "failed" : "completed", verdict.status.replaceAll("_", " ").toLowerCase());
  s.canRetry = retryEligibleAfterFinalize(s);
}

function retryEligibleAfterFinalize(s: InternalSession): boolean {
  const save = s.running;
  s.running = false;
  const ok = retryEligible(s);
  s.running = save;
  return ok;
}

function fail(s: InternalSession, e: unknown) {
  let code = "INTERNAL_ERROR";
  let message = "Something went wrong while running the investigation.";
  if (e instanceof WorkflowError) ({ code, message } = e);
  else if (e instanceof ModelError) ({ code, message } = { code: e.code, message: e.message });
  else if (e instanceof BudgetError) ({ code, message } = { code: "BUDGET_EXHAUSTED", message: e.message });
  else console.error("[patchpilot] unexpected workflow error:", e instanceof Error ? e.name : typeof e);
  s.status = "error";
  s.error = { code, message };
  s.canRetry = false;
  for (const step of s.steps) {
    if (step.state === "running") {
      step.state = "failed";
      step.detail = message;
    } else if (step.state === "pending") step.state = "skipped";
  }
}
