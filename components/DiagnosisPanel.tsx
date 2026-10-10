"use client";

import { Download, FileCode2, RotateCcw, RefreshCw } from "lucide-react";
import { useState } from "react";
import { download } from "@/lib/client";
import type { Attempt, SessionView } from "@/lib/types";
import { CodeDiff, type EditorPrefs } from "./CodeEditor";
import { Empty, Panel, StatusBadge, Tag } from "./ui";

type View = "split" | "inline" | "unified";

export function DiagnosisPanel({ session, prefs, onReset, onRetry, retrying }: { session: SessionView | null; prefs: EditorPrefs; onReset: () => void; onRetry: () => void; retrying: boolean }) {
  const [view, setView] = useState<View>("split");
  const d = session?.diagnosis;
  const attempt: Attempt | undefined = session ? ([...session.attempts].reverse().find((a) => a.patchStatus === "applied") ?? session.attempts.at(-1)) : undefined;
  const applied = attempt?.patchStatus === "applied" && attempt.repairedSource !== undefined;

  return (
    <Panel
      title="Diagnosis & patch"
      className="h-full"
      right={
        <div className="flex items-center gap-1">
          <button disabled={!applied} onClick={() => attempt?.repairedSource && download("solution.repaired.py", attempt.repairedSource, "text/x-python")} className="flex items-center gap-1 border border-line px-1.5 py-0.5 text-[11px] text-ink-dim hover:text-ink disabled:opacity-40" title="Download repaired Python file">
            <FileCode2 size={12} aria-hidden /> .py
          </button>
          <button disabled={!applied} onClick={() => attempt?.diff && download("patchpilot.diff", attempt.diff, "text/x-diff")} className="flex items-center gap-1 border border-line px-1.5 py-0.5 text-[11px] text-ink-dim hover:text-ink disabled:opacity-40" title="Download patch as .diff">
            <Download size={12} aria-hidden /> .diff
          </button>
          <button disabled={!session} onClick={onReset} className="flex items-center gap-1 border border-line px-1.5 py-0.5 text-[11px] text-ink-dim hover:text-ink disabled:opacity-40" title="Reset session">
            <RotateCcw size={12} aria-hidden /> Reset
          </button>
        </div>
      }
    >
      {!session ? (
        <Empty>The diagnosis, proposed patch and verification verdict appear here. Your original source is never overwritten.</Empty>
      ) : (
        <div className="flex h-full min-h-0 flex-col">
          {session.finalStatus && (
            <div className="space-y-1.5 border-b border-line p-3">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={session.finalStatus} />
                {session.mode === "preview" && <Tag tone="warn">preview · not executed</Tag>}
                {session.reproduced !== undefined && <Tag tone={session.reproduced ? "ok" : "mute"}>{session.reproduced ? "failure reproduced" : "not reproduced"}</Tag>}
              </div>
              <p className="text-[12px] leading-snug text-ink-dim">{session.finalReason}</p>
              {session.canRetry && (
                <button onClick={onRetry} disabled={retrying} className="flex items-center gap-1.5 border border-cyan/50 px-2 py-1 text-[11px] text-cyan hover:bg-cyan/10 disabled:opacity-50">
                  <RefreshCw size={12} className={retrying ? "animate-spin" : ""} aria-hidden /> Try another repair ({2 - session.repairAttemptsUsed} left)
                </button>
              )}
            </div>
          )}
          {d ? (
            <div className="space-y-2 border-b border-line p-3 text-[12px] leading-snug">
              <Block label="Summary">{d.summary}</Block>
              <Block label="Suspected root cause">{d.rootCause}</Block>
              <Block label="Proposed change">{d.reasoning}</Block>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-ink-faint">Lines</span>
                {d.affectedLines.length ? d.affectedLines.slice(0, 20).map((l) => <Tag key={l} tone="info">{l}</Tag>) : <span className="text-ink-faint">not specified</span>}
              </div>
              {d.limitations.length > 0 && (
                <Block label="Limitations / uncertainty">
                  <ul className="list-disc pl-4 text-warn">{d.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul>
                </Block>
              )}
              {d.edgeCases.length > 0 && (
                <Block label="Edge cases">
                  <ul className="list-disc pl-4">{d.edgeCases.map((l, i) => <li key={i}>{l}</li>)}</ul>
                </Block>
              )}
            </div>
          ) : (
            session.status === "running" && <Empty>Waiting for the model…</Empty>
          )}
          {attempt && (
            <div className="flex min-h-[300px] flex-1 flex-col">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-1.5">
                <div className="flex items-center gap-2 text-[11px]">
                  {applied ? <Tag tone="ok">patch applied</Tag> : <Tag tone="bad">patch rejected</Tag>}
                  {applied && <><span className="font-mono text-accent">+{attempt.added}</span><span className="font-mono text-danger">−{attempt.removed}</span></>}
                  <span className="text-ink-faint">attempt {attempt.index + 1}</span>
                </div>
                {applied && (
                  <div role="tablist" aria-label="Patch view" className="flex text-[11px]">
                    {(["split", "inline", "unified"] as View[]).map((v) => (
                      <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)} className={`border border-line px-2 py-0.5 ${view === v ? "bg-surface-2 text-ink" : "text-ink-faint"}`}>
                        {v === "split" ? "Side by side" : v === "inline" ? "Inline" : "Unified text"}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {!applied ? (
                <div className="p-3 text-[12px] text-danger" role="alert">{attempt.patchError}</div>
              ) : view === "unified" ? (
                <pre className="min-h-0 flex-1 overflow-auto p-3 font-mono text-[12px] leading-relaxed">
                  {attempt.diff!.split("\n").map((l, i) => (
                    <span key={i} className={`block ${l.startsWith("+") && !l.startsWith("+++") ? "bg-accent/10 text-accent" : l.startsWith("-") && !l.startsWith("---") ? "bg-danger/10 text-danger" : l.startsWith("@@") ? "text-cyan" : "text-ink-dim"}`}>{l || " "}</span>
                  ))}
                </pre>
              ) : (
                <div className="min-h-[260px] flex-1">
                  <CodeDiff original={session.originalSource} modified={attempt.repairedSource!} prefs={prefs} sideBySide={view === "split"} />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-widest text-ink-faint">{label}</div>
      <div className="text-ink">{children}</div>
    </div>
  );
}
