"use client";

import { Bug, Plus, Settings, TerminalSquare } from "lucide-react";
import { useState } from "react";
import type { HealthView } from "@/lib/types";
import type { EditorPrefs } from "./CodeEditor";

export function TopBar({ health, onNew, prefs, setPrefs, busy }: { health: HealthView | null; onNew: () => void; prefs: EditorPrefs; setPrefs: (p: EditorPrefs) => void; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const state = !health ? "checking" : health.mode;
  const dot = { checking: "bg-ink-faint pp-pulse", full: "bg-accent", preview: "bg-warn", unavailable: "bg-danger" }[state];
  const text = {
    checking: "Checking configuration…",
    full: `Groq ${health?.groq.model ?? ""} · sandbox: ${health?.sandbox.provider}`,
    preview: "Preview mode: sandbox not configured — code is not executed",
    unavailable: "Groq not configured (GROQ_API_KEY, GROQ_MODEL)",
  }[state];
  return (
    <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-3">
      <div className="flex items-center gap-2">
        <span className="grid h-6 w-6 place-items-center border border-accent/50 text-accent">
          <Bug size={14} aria-hidden />
        </span>
        <span className="font-mono text-[15px] font-semibold tracking-tight">
          Patch<span className="text-accent">Pilot</span>
        </span>
        <span className="ml-2 hidden text-[11px] text-ink-faint xl:inline">Find the bug. Fix the code. Prove it works.</span>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex min-w-0 items-center gap-2 border border-line px-2 py-1 text-[11px] text-ink-dim" title={text} role="status">
          <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden />
          <span className="max-w-[44vw] truncate sm:max-w-[28rem]">{text}</span>
        </span>
        <span className="hidden items-center gap-1 border border-line px-2 py-1 font-mono text-[11px] text-cyan sm:flex">
          <TerminalSquare size={12} aria-hidden /> Python
        </span>
        <button onClick={onNew} className="flex items-center gap-1 border border-line px-2 py-1 text-[12px] text-ink-dim hover:border-line-strong hover:text-ink">
          <Plus size={13} aria-hidden /> <span className="hidden sm:inline">New Session</span>
          <span className="sr-only sm:hidden">New Session</span>
        </button>
        <div className="relative">
          <button aria-label="Settings" aria-expanded={open} onClick={() => setOpen(!open)} className="border border-line p-1.5 text-ink-dim hover:text-ink">
            <Settings size={14} aria-hidden />
          </button>
          {open && (
            <div className="absolute right-0 top-9 z-50 w-56 border border-line-strong bg-surface-2 p-3 shadow-xl" role="dialog" aria-label="Editor settings">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-ink-faint">Editor (stored in this browser)</p>
              <label className="mb-2 flex items-center justify-between text-[12px]">
                Font size
                <input
                  type="number" min={11} max={20} value={prefs.fontSize}
                  onChange={(e) => setPrefs({ ...prefs, fontSize: Math.min(20, Math.max(11, Number(e.target.value) || 13)) })}
                  className="w-14 border border-line bg-bg px-1 py-0.5 text-right font-mono"
                />
              </label>
              <label className="flex items-center justify-between text-[12px]">
                Word wrap
                <input type="checkbox" checked={prefs.wordWrap} onChange={(e) => setPrefs({ ...prefs, wordWrap: e.target.checked })} className="accent-[var(--color-accent)]" />
              </label>
              <p className="mt-3 text-[10px] leading-snug text-ink-faint">API keys live only on the server and are never shown here.</p>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
