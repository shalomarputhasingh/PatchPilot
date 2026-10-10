"use client";

import { Loader2, Play } from "lucide-react";
import { LIMITS } from "@/lib/limits";
import { CodeEditor, type EditorPrefs } from "./CodeEditor";
import { Panel } from "./ui";

export interface InputState {
  source: string;
  bugReport: string;
  expectedBehavior: string;
  notes: string;
  stdin: string;
  userTests: string;
}

const field = "w-full resize-y border border-line bg-bg px-2 py-1.5 text-[12px] leading-snug text-ink placeholder:text-ink-faint focus:border-accent/60 focus:outline-none disabled:opacity-60";

function Count({ n, max }: { n: number; max: number }) {
  return <span className={`font-mono text-[10px] ${n > max ? "text-danger" : "text-ink-faint"}`}>{n}/{max}</span>;
}

export function InputPanel({ value, onChange, errors, running, onSubmit, prefs }: { value: InputState; onChange: (v: InputState) => void; errors: Record<string, string>; running: boolean; onSubmit: () => void; prefs: EditorPrefs }) {
  const set = <K extends keyof InputState>(k: K, v: InputState[K]) => onChange({ ...value, [k]: v });
  return (
    <Panel
      title="Source & bug report"
      right={<Count n={value.source.length} max={LIMITS.maxSourceChars} />}
      className="h-full"
    >
      <form
        className="flex h-full min-h-0 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <div className={`min-h-[220px] flex-[3] border-b ${errors.source ? "border-danger" : "border-line"}`}>
          <CodeEditor label="Python source editor" value={value.source} onChange={(v) => set("source", v)} readOnly={running} prefs={prefs} />
        </div>
        {errors.source && <p role="alert" className="px-3 pt-1 text-[11px] text-danger">{errors.source}</p>}
        <div className="flex min-h-0 flex-[2] flex-col gap-2 overflow-auto p-3">
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label htmlFor="bug" className="text-[11px] font-semibold uppercase tracking-wide text-ink-dim">Bug description <span className="text-danger">*</span></label>
              <Count n={value.bugReport.length} max={LIMITS.maxBugChars} />
            </div>
            <textarea id="bug" rows={3} value={value.bugReport} disabled={running} onChange={(e) => set("bugReport", e.target.value)} aria-invalid={!!errors.bugReport} className={`${field} ${errors.bugReport ? "border-danger" : ""}`} placeholder="What goes wrong? Include the inputs and what you expected." />
            {errors.bugReport && <p role="alert" className="mt-1 text-[11px] text-danger">{errors.bugReport}</p>}
          </div>
          <details className="group border border-line">
            <summary className="cursor-pointer select-none px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-dim hover:text-ink">Optional details</summary>
            <div className="flex flex-col gap-2 border-t border-line p-2">
              <label className="text-[11px] text-ink-dim">Expected behavior
                <textarea rows={2} value={value.expectedBehavior} disabled={running} onChange={(e) => set("expectedBehavior", e.target.value)} className={`${field} mt-1`} placeholder="e.g. calculate_discount(100, 20) returns 80" />
              </label>
              {errors.expectedBehavior && <p role="alert" className="text-[11px] text-danger">{errors.expectedBehavior}</p>}
              <label className="text-[11px] text-ink-dim">Reproduction notes
                <textarea rows={2} value={value.notes} disabled={running} onChange={(e) => set("notes", e.target.value)} className={`${field} mt-1`} placeholder="Steps, environment, anything the code does not show" />
              </label>
              <label className="text-[11px] text-ink-dim">Standard input for the program run
                <textarea rows={2} value={value.stdin} disabled={running} onChange={(e) => set("stdin", e.target.value)} className={`${field} mt-1 font-mono`} placeholder="Passed to stdin when the program is executed" />
              </label>
              <label className="text-[11px] text-ink-dim">Existing tests <span className="text-ink-faint">(Python; run as user_tests.py, import code with <code className="font-mono">from solution import …</code>; exit code 0 = pass)</span>
                <textarea rows={4} value={value.userTests} disabled={running} onChange={(e) => set("userTests", e.target.value)} className={`${field} mt-1 font-mono`} placeholder={"from solution import my_func\nassert my_func(2) == 4"} />
              </label>
            </div>
          </details>
          <button
            type="submit"
            disabled={running}
            className="mt-auto flex h-9 items-center justify-center gap-2 border border-accent bg-accent/10 font-mono text-[12px] font-semibold uppercase tracking-wider text-accent transition-colors hover:bg-accent/20 disabled:cursor-not-allowed disabled:border-line disabled:bg-surface-2 disabled:text-ink-faint"
          >
            {running ? <><Loader2 size={14} className="animate-spin" aria-hidden /> Investigating…</> : <><Play size={14} aria-hidden /> Investigate Bug</>}
          </button>
        </div>
      </form>
    </Panel>
  );
}
