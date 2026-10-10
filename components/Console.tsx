"use client";

import type { Attempt, ExecutionResult, SessionView, TestRun, UserTestRun } from "@/lib/types";
import { Empty, Panel, Tag } from "./ui";

export type ConsoleTab = "orig" | "rep" | "user" | "gen" | "att";
const TABS: { id: ConsoleTab; label: string }[] = [
  { id: "orig", label: "Original execution" },
  { id: "rep", label: "Repaired execution" },
  { id: "user", label: "Existing tests" },
  { id: "gen", label: "Generated regression tests" },
  { id: "att", label: "Repair attempts" },
];

export function Console({ session, tab, setTab }: { session: SessionView | null; tab: ConsoleTab; setTab: (t: ConsoleTab) => void }) {
  const final = session ? ([...session.attempts].reverse().find((a) => a.patchStatus === "applied") ?? undefined) : undefined;
  return (
    <Panel
      title="Execution console"
      className="h-full"
      right={
        <div role="tablist" aria-label="Console tabs" className="-mr-1 flex max-w-[75vw] overflow-x-auto">
          {TABS.map((t) => (
            <button key={t.id} role="tab" id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls="console-body" onClick={() => setTab(t.id)} className={`whitespace-nowrap border-b-2 px-2.5 py-1 text-[11.5px] ${tab === t.id ? "border-accent text-ink" : "border-transparent text-ink-faint hover:text-ink-dim"}`}>
              {t.label}
            </button>
          ))}
        </div>
      }
    >
      <div id="console-body" role="tabpanel" aria-labelledby={`tab-${tab}`} className="h-full">
        {!session ? <Empty>Real stdout, stderr, exit codes and test outcomes from the sandbox appear here.</Empty>
          : tab === "orig" ? <Exec e={session.baseline} none={session.mode === "preview" ? "Not run — the sandbox is not configured (preview mode)." : "Not run yet."} />
          : tab === "rep" ? <Exec e={final?.repairedExecution} none={final ? "Not run." : "No patch has been applied yet."} />
          : tab === "user" ? <UserTests before={session.baselineUserTests} after={final?.userTests} supplied={session.attempts.some((a) => a.userTests) || !!session.baselineUserTests} />
          : tab === "gen" ? <Generated session={session} after={final?.generatedTests} />
          : <Attempts attempts={session.attempts} />}
      </div>
    </Panel>
  );
}

function Exec({ e, none }: { e?: ExecutionResult; none: string }) {
  if (!e) return <Empty>{none}</Empty>;
  return (
    <div className="p-3 font-mono text-[12px]">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Tag tone={e.providerError ? "warn" : e.exitCode === 0 && !e.timedOut ? "ok" : "bad"}>
          {e.providerError ? "sandbox error" : e.timedOut ? "timed out" : `exit ${e.exitCode}`}
        </Tag>
        {e.signal && <Tag tone="warn">{e.signal}</Tag>}
        {e.truncated && <Tag tone="warn">output truncated</Tag>}
        <span className="text-[10px] text-ink-faint">{e.durationMs}ms round trip</span>
      </div>
      {e.providerError && <p className="mb-2 text-warn">{e.providerError}</p>}
      <Stream label="stdout" text={e.stdout} />
      <Stream label="stderr" text={e.stderr} danger />
    </div>
  );
}

function Stream({ label, text, danger }: { label: string; text: string; danger?: boolean }) {
  return (
    <div className="mb-2">
      <div className="mb-0.5 text-[10px] uppercase tracking-widest text-ink-faint">{label}</div>
      {text ? <pre className={`whitespace-pre-wrap break-words border border-line bg-bg p-2 leading-relaxed ${danger ? "text-danger" : "text-ink"}`}>{text}</pre> : <div className="text-ink-faint">(empty)</div>}
    </div>
  );
}

const tone = (s: string) => (s === "passed" ? "ok" : s === "not_run" ? "mute" : "bad") as "ok" | "mute" | "bad";

function Generated({ session, after }: { session: SessionView; after?: TestRun }) {
  const tests = session.regressionTests;
  if (!tests.length) return <Empty>{session.diagnosis ? "No regression tests were proposed for this file." : "Not generated yet."}</Empty>;
  const before = session.baselineTests;
  return (
    <div className="p-3">
      <p className="mb-2 text-[11px] leading-snug text-ink-faint">Tests are AI-authored structured cases, executed by a fixed harness. A passing test is evidence for that case only. “Before” runs against your original code; “after” against the patched copy.</p>
      <table className="w-full border-collapse text-left text-[12px]">
        <thead><tr className="border-b border-line text-[10px] uppercase tracking-widest text-ink-faint"><th className="py-1 pr-2 font-medium">Test</th><th className="px-2 font-medium">Before</th><th className="px-2 font-medium">After</th></tr></thead>
        <tbody>
          {tests.map((t, i) => {
            const b = before?.outcomes[i];
            const a = after?.outcomes[i];
            return (
              <tr key={t.name} className="border-b border-line align-top">
                <td className="py-1.5 pr-2">
                  <div>{t.name}</div>
                  <div className="font-mono text-[11px] text-ink-faint">{t.function}({[...t.args.map((x) => JSON.stringify(x)), ...Object.entries(t.kwargs).map(([k, v]) => `${k}=${JSON.stringify(v)}`)].join(", ")}) → {JSON.stringify(t.expected)}</div>
                  {a?.message && a.status !== "passed" && <div className="font-mono text-[11px] text-danger">{a.message}</div>}
                </td>
                <td className="px-2"><Tag tone={tone(b?.status ?? "not_run")}>{(b?.status ?? "not run").replace("_", " ")}</Tag></td>
                <td className="px-2"><Tag tone={tone(a?.status ?? "not_run")}>{(a?.status ?? "not run").replace("_", " ")}</Tag></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {after?.note && <p className="mt-2 text-[11px] text-warn">{after.note}</p>}
      {after?.execution && after.outcomes.some((o) => o.status === "not_run") && <Exec e={after.execution} none="" />}
    </div>
  );
}

function UserTests({ before, after, supplied }: { before?: UserTestRun; after?: UserTestRun; supplied: boolean }) {
  if (!supplied) return <Empty>No existing tests were supplied. Add some under “Optional details” to include them in verification.</Empty>;
  return (
    <div className="grid gap-3 p-3 md:grid-cols-2">
      {[["Before (original code)", before], ["After (patched copy)", after]].map(([label, r]) => {
        const run = r as UserTestRun | undefined;
        return (
          <div key={label as string}>
            <div className="mb-1 flex items-center gap-2 text-[11px] uppercase tracking-wide text-ink-dim">{label as string}{run ? <Tag tone={run.ran ? (run.passed ? "ok" : "bad") : "mute"}>{run.ran ? (run.passed ? "passed" : "failed") : "not run"}</Tag> : <Tag tone="mute">not run</Tag>}</div>
            {run?.execution ? <Exec e={run.execution} none="" /> : <Empty>Not run.</Empty>}
          </div>
        );
      })}
    </div>
  );
}

function Attempts({ attempts }: { attempts: Attempt[] }) {
  if (!attempts.length) return <Empty>No patch attempts yet.</Empty>;
  return (
    <ol className="divide-y divide-line">
      {attempts.map((a) => {
        const nPass = a.generatedTests?.outcomes.filter((o) => o.status === "passed").length ?? 0;
        const nAll = a.generatedTests?.outcomes.length ?? 0;
        return (
          <li key={a.index} className="p-3 text-[12px]">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="font-mono text-ink">#{a.index + 1} {a.kind}</span>
              <Tag tone={a.patchStatus === "applied" ? "ok" : "bad"}>{a.patchStatus}</Tag>
              {a.patchStatus === "applied" && <Tag tone={a.passed ? "ok" : a.repairedExecution?.providerError ? "warn" : "bad"}>{a.passed ? "checks passed" : a.repairedExecution?.providerError ? "not verified" : "checks failed"}</Tag>}
              {a.added !== undefined && <span className="font-mono text-[11px] text-ink-faint">+{a.added} −{a.removed}</span>}
              {nAll > 0 && <span className="font-mono text-[11px] text-ink-faint">{nPass}/{nAll} generated tests</span>}
              {a.durationMs !== undefined && <span className="font-mono text-[10px] text-ink-faint">{(a.durationMs / 1000).toFixed(1)}s</span>}
            </div>
            <p className="text-ink-dim">{a.reasoning}</p>
            {a.patchError && <p className="mt-1 text-danger">{a.patchError}</p>}
            {a.generatedTests?.outcomes.filter((o) => o.status === "failed" || o.status === "error").map((o) => (
              <p key={o.name} className="mt-1 font-mono text-[11px] text-danger">✗ {o.name}: {o.message}</p>
            ))}
            <details className="mt-1"><summary className="cursor-pointer text-[11px] text-cyan">Raw model diff</summary><pre className="mt-1 overflow-auto border border-line bg-bg p-2 font-mono text-[11px]">{a.rawDiff}</pre></details>
          </li>
        );
      })}
    </ol>
  );
}
