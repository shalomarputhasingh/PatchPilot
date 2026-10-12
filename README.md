# PatchPilot

**Find the bug. Fix the code. Prove it works.**

PatchPilot is a single-page debugging workbench for one Python file. It runs your code in a sandbox, asks Groq for a diagnosis and a minimal unified-diff patch, applies the patch to a disposable copy, re-runs everything, and reports a verdict computed by deterministic application logic — never by the model.

## Run it

```bash
npm install          # also copies Monaco into public/monaco (self-hosted, no CDN)
cp .env.example .env.local   # fill in values
npm run dev          # or: npm run build && npm start
npm test             # unit + integration tests (use local test doubles, no network)
```

PatchPilot keeps session state in server memory and runs the workflow in the background while the browser polls, so it needs a **long-lived Node server** (`next start`, a container, a VM). It will not work on serverless platforms that spread requests across instances. Sessions expire after 1 hour and are lost on restart.

### Environment (server-side only)

| Variable | Purpose |
|---|---|
| `GROQ_API_KEY`, `GROQ_MODEL` | Required. No model default is assumed; pick a Groq model that supports JSON output (e.g. `openai/gpt-oss-120b`). |
| `GROQ_BASE_URL` | Optional API base override. |
| `SANDBOX_PROVIDER` | `piston` (the only adapter implemented). |
| `SANDBOX_API_URL`, `SANDBOX_API_KEY` | Sandbox base URL; optional bearer token. |
| `NEXT_PUBLIC_APP_URL` | App URL. |
| `SESSION_BUDGET_MS`, `SANDBOX_RUN_TIMEOUT_MS` | Optional total workflow budget (default 150 s) and per-run timeout (default 10 s). |

`GET /api/health` reports configuration status without exposing secrets.

### Configuration states

- **Groq missing** → `POST /api/debug` returns `503 NOT_CONFIGURED`; the top bar shows red.
- **Sandbox missing** → **preview mode**, clearly labeled in the UI: Groq proposes a patch and PatchPilot validates that it applies, but nothing is executed and the verdict is always `UNVERIFIED`.

## The sandbox contract — read this

No sandbox provider was specified for this project. `lib/sandbox/piston.ts` implements the interface in `lib/sandbox/types.ts` for **Piston-compatible APIs** (`POST {SANDBOX_API_URL}/api/v2/execute`), based on Piston's public documentation. **It has not been verified against a live deployment**; tests run it against a local double that mimics the documented shape. Before trusting it, point it at your Piston instance and check: auth header format, how timeouts are reported (v3 `status: "TO"` vs. `SIGKILL`), and multi-file support (the test harness needs it).

Isolation, resource limits and network restrictions are enforced by the sandbox deployment, not by PatchPilot. **Do not accept arbitrary user code unless your sandbox enforces them.** To use another provider, implement `SandboxAdapter` and register it in `lib/sandbox/index.ts`; nothing else changes. Submitted code never runs in the Next.js process.

## How verification works

1. **Baseline** — original code runs in the sandbox (optional stdin). Output is passed to Groq as evidence.
2. **Diagnosis + patch** — one structured JSON call, validated with Zod (one re-ask on malformed output). Source, bug text and logs are fenced as untrusted data in the prompt.
3. **Patch validation** (`lib/patch.ts`) — single file only; no create/delete; hunk context must match the analyzed source exactly (line numbers are only hints; ambiguous or non-matching hunks are rejected); whole-file rewrites rejected; size limits. One corrected patch may be requested if it fails.
4. **Execution** — patched copy runs; the original source is never modified.
5. **Tests** — the model proposes *structured* cases (`function`, `args`, `kwargs`, `expected` as JSON). They are never spliced into code: a fixed Python runner imports `solution.py` and compares results. The same tests also run against the **original** code, which is how a bug without a crash is shown to be reproduced. Optional user tests (`user_tests.py`, exit code 0 = pass) are run separately before and after.
6. **Repair loop** — if the patch applies but checks fail, Groq gets the failures and writes a new patch against the original (max **2** repair attempts, counted server-side before the call; `POST /api/debug/{id}/retry` can resume only if attempts remain, e.g. after a provider error). Stops on sandbox errors, an invalid model response, or session-budget exhaustion.

### Final statuses (`lib/verdict.ts`)

| Status | Condition |
|---|---|
| `VERIFIED` | Failure reproduced on the original (crash/timeout, failing generated test, or failing user test); patch applied; patched code exits 0; every generated test passed; user tests passed if supplied. |
| `PARTIALLY_VERIFIED` | Reproduced and nothing failed after the patch, but evidence is missing (no generated tests ran, or some were `not_run`). |
| `UNVERIFIED` | Nothing executed (preview mode), sandbox error, or the workflow was cut short before tests completed. |
| `FAILED` | Patch could not be applied, or the patched code crashed/timed out, or an executed test failed. |
| `BASELINE_NOT_REPRODUCED` | Patch applied and checks pass, but nothing failed on the original code. |

A passing generated test is evidence for that case, not proof. Generated tests are AI-authored and can themselves be wrong; a wrong test yields `FAILED`, not a silent pass.

## API

- `POST /api/debug` → `202` with the session; body `{ source, bugReport, expectedBehavior?, notes?, stdin?, userTests? }`.
- `GET /api/debug/{id}` → current state (steps, diagnosis, attempts, test results, final status, sanitized error).
- `POST /api/debug/{id}/retry` → `409` unless an attempt is genuinely available.
- `GET /api/health`.

Errors share one shape: `{ "error": { "code", "message", "fields"? } }`. Provider keys, stack traces and source code are not logged or returned in errors.

## Known limitations

- Python only, one file, function-call regression tests (no stdout-comparison tests, no third-party dependencies).
- Execution duration is measured as a round trip by PatchPilot; the provider contract reports none.
- Sessions are in memory; at most 4 run concurrently.
- Not done: authentication, rate limiting per user, persistence — add these before exposing the app publicly.

## Project report (college Web Technology mini project)

A print-ready, black-and-white A4 report lives at **`/report`** (`app/(report)/`). It has its own root layout and stylesheet, so none of the website's dark theme applies.

1. Run the app (`npm run dev`) and open `http://localhost:3000/report`.
2. Click **Print / Save as PDF** (or Ctrl/Cmd+P), choose **A4**, margins **None**, and enable **Background graphics** if offered. The page border is part of each page, so it prints on every page.
3. Code excerpts are read live from the project's real source files (`app/(report)/report/excerpts.ts`). `EX NO:` is intentionally blank. The last page ends with a short RESULT line.
4. `public/report/output.png` is the screenshot used in the report; `public/report/PatchPilot-Report.pdf` is a pre-rendered copy. The pre-rendered copy was produced in an environment without Times New Roman, so it uses the metric-compatible Liberation Serif; printing from your own browser uses real Times New Roman if installed.
