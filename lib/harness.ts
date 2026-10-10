import type { ExecutionResult, RegressionTest, TestOutcome, TestRun } from "./types";
import type { SandboxFile } from "./sandbox/types";

/**
 * Controlled test runner. Generated tests are NEVER spliced into Python source:
 * they travel as JSON data (tests.json) and are executed by this fixed runner,
 * which imports the submitted code as module `solution` and calls named functions.
 */
export const RUNNER_FILENAME = "pp_runner.py";
export const MODULE_FILENAME = "solution.py";
export const RESULT_MARKER = "__PATCHPILOT_RESULT__";

export const RUNNER_SOURCE = `import contextlib, io, json, math, os, signal, sys, traceback

MARK = ${JSON.stringify(RESULT_MARKER)}
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)


def emit(payload):
    sys.stdout.write("\\n" + MARK + json.dumps(payload) + "\\n")
    sys.stdout.flush()


def same(a, b):
    if isinstance(a, bool) or isinstance(b, bool):
        return type(a) is type(b) and a == b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return math.isclose(a, b, rel_tol=1e-9, abs_tol=1e-9)
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(same(x, y) for x, y in zip(a, b))
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(same(a[k], b[k]) for k in a)
    return a == b


def to_json_value(v):
    return json.loads(json.dumps(v, default=repr))


class Timeout(Exception):
    pass


def on_alarm(signum, frame):
    raise Timeout()


def main():
    with open(os.path.join(HERE, "tests.json")) as f:
        tests = json.load(f)
    out = io.StringIO()
    err = io.StringIO()
    try:
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            import solution
    except BaseException as e:  # includes SystemExit from the user's top-level code
        emit({"importError": "%s: %s" % (type(e).__name__, e), "traceback": traceback.format_exc()[-1500:]})
        return
    if hasattr(signal, "SIGALRM"):
        signal.signal(signal.SIGALRM, on_alarm)
    results = []
    for t in tests:
        r = {"name": t["name"]}
        try:
            fn = getattr(solution, t["function"], None)
            if not callable(fn):
                r.update(status="error", message="function %r not found in submitted code" % t["function"])
            else:
                if hasattr(signal, "SIGALRM"):
                    signal.alarm(3)
                with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                    actual = fn(*t.get("args", []), **t.get("kwargs", {}))
                if hasattr(signal, "SIGALRM"):
                    signal.alarm(0)
                actual_j = to_json_value(actual)
                r["actual"] = json.dumps(actual_j)[:500]
                if same(actual_j, t["expected"]):
                    r["status"] = "passed"
                else:
                    r.update(status="failed", message="expected %s, got %s" % (json.dumps(t["expected"])[:200], json.dumps(actual_j)[:200]))
        except Timeout:
            r.update(status="error", message="test exceeded 3s")
        except BaseException as e:
            if hasattr(signal, "SIGALRM"):
                signal.alarm(0)
            r.update(status="error", message="%s: %s" % (type(e).__name__, e))
        results.append(r)
    emit({"results": results})


main()
`;

export function buildHarnessFiles(source: string, tests: RegressionTest[]): SandboxFile[] {
  return [
    { name: RUNNER_FILENAME, content: RUNNER_SOURCE },
    { name: MODULE_FILENAME, content: source },
    {
      name: "tests.json",
      content: JSON.stringify(
        tests.map((t) => ({ name: t.name, function: t.function, args: t.args, kwargs: t.kwargs, expected: t.expected })),
      ),
    },
  ];
}

/** Turn raw harness output into per-test outcomes. Missing verdicts are "not_run", never "passed". */
export function parseHarnessOutput(tests: RegressionTest[], execution: ExecutionResult): TestRun {
  const notRun = (note: string): TestRun => ({
    ran: false,
    execution,
    note,
    outcomes: tests.map((t) => ({ name: t.name, status: "not_run" as const })),
  });
  if (execution.providerError) return notRun(execution.providerError);

  const line = execution.stdout.split("\n").find((l) => l.startsWith(RESULT_MARKER));
  if (!line) {
    return notRun(
      execution.timedOut
        ? "Test run timed out before reporting results."
        : "Test runner produced no result (see stderr).",
    );
  }
  let payload: unknown;
  try {
    payload = JSON.parse(line.slice(RESULT_MARKER.length));
  } catch {
    return notRun("Test runner output could not be parsed.");
  }
  const p = payload as { importError?: unknown; traceback?: unknown; results?: unknown };
  if (typeof p.importError === "string") {
    // The code under test failed to import: every test is a genuine failure of that code.
    return {
      ran: true,
      execution,
      note: `Module failed to import: ${p.importError}`,
      outcomes: tests.map((t) => ({ name: t.name, status: "error" as const, message: `import failed: ${p.importError}` })),
    };
  }
  const results = Array.isArray(p.results) ? (p.results as Record<string, unknown>[]) : [];
  const outcomes: TestOutcome[] = tests.map((t, i) => {
    const r = results[i];
    const status = r?.status;
    if (r && r.name === t.name && (status === "passed" || status === "failed" || status === "error")) {
      return {
        name: t.name,
        status,
        message: typeof r.message === "string" ? r.message : undefined,
        actual: typeof r.actual === "string" ? r.actual : undefined,
      };
    }
    return { name: t.name, status: "not_run" as const };
  });
  return { ran: true, execution, outcomes };
}
