"use client";

import { Check, Circle, Loader2, Minus, X } from "lucide-react";
import type { SessionView, StepInfo } from "@/lib/types";
import { Panel, StatusBadge } from "./ui";

function Icon({ s }: { s: StepInfo["state"] }) {
  switch (s) {
    case "completed": return <Check size={13} className="text-accent" aria-hidden />;
    case "running": return <Loader2 size={13} className="animate-spin text-cyan" aria-hidden />;
    case "failed": return <X size={13} className="text-danger" aria-hidden />;
    case "skipped": return <Minus size={13} className="text-ink-faint" aria-hidden />;
    default: return <Circle size={9} className="text-ink-faint" aria-hidden />;
  }
}

const fmt = (ms?: number) => (ms === undefined ? "" : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`);

export function Timeline({ session, onJump }: { session: SessionView | null; onJump: (tab: "orig" | "rep" | "gen" | "att") => void }) {
  const steps = session?.steps;
  return (
    <Panel title="Investigation" className="h-full">
      {!steps ? (
        <div className="p-4 text-[12px] leading-relaxed text-ink-faint">
          <p>Submit source and a bug report. Each step below reports what really happened — nothing is marked complete until it has finished.</p>
          <ol className="mt-3 space-y-2" aria-label="Planned steps">
            {["Input validated", "Original code executed", "Failure analyzed", "Patch generated", "Patch validated", "Repaired code executed", "Regression tests evaluated", "Final result prepared"].map((l, i) => (
              <li key={l} className="flex items-center gap-2"><span className="w-4 text-right font-mono text-[10px]">{i + 1}</span>{l}</li>
            ))}
          </ol>
        </div>
      ) : (
        <ol className="p-3" aria-label="Investigation steps">
          {steps.map((st, i) => {
            const link = st.id === "baseline" ? "orig" : st.id === "repaired" ? "rep" : st.id === "tests" ? "gen" : null;
            return (
              <li key={st.id} className="relative flex gap-3 pb-4 last:pb-0" aria-current={st.state === "running" ? "step" : undefined}>
                {i < steps.length - 1 && <span className="absolute left-[9px] top-5 h-[calc(100%-12px)] w-px bg-line" aria-hidden />}
                <span className={`z-10 mt-0.5 grid h-[19px] w-[19px] shrink-0 place-items-center border bg-surface ${st.state === "completed" ? "border-accent/50" : st.state === "failed" ? "border-danger/60" : st.state === "running" ? "border-cyan/60" : "border-line"}`}>
                  <Icon s={st.state} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className={`text-[12.5px] ${st.state === "pending" || st.state === "skipped" ? "text-ink-faint" : "text-ink"}`}>{st.label}</span>
                    <span className="font-mono text-[10px] text-ink-faint"><span className="sr-only">{st.state} </span>{fmt(st.durationMs)}</span>
                  </div>
                  {st.detail && <p className="mt-0.5 break-words text-[11px] leading-snug text-ink-dim">{st.detail}</p>}
                  {link && st.state !== "pending" && st.state !== "skipped" && (
                    <button onClick={() => onJump(link)} className="mt-0.5 text-[10px] uppercase tracking-wide text-cyan hover:underline">View output</button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {session?.notices.map((n, i) => (
        <p key={i} className="mx-3 mb-2 border-l-2 border-warn/60 pl-2 text-[11px] leading-snug text-warn">{n}</p>
      ))}
      {session?.error && (
        <p role="alert" className="mx-3 mb-3 border border-danger/40 bg-danger/10 p-2 text-[11.5px] leading-snug text-danger">
          <span className="font-mono text-[10px] uppercase">{session.error.code}</span><br />{session.error.message}
        </p>
      )}
      {session?.finalStatus && <div className="px-3 pb-3"><StatusBadge status={session.finalStatus} /></div>}
    </Panel>
  );
}
