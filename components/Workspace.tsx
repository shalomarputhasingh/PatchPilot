"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiRequestError } from "@/lib/client";
import { LIMITS } from "@/lib/limits";
import { SAMPLE_BUG, SAMPLE_SOURCE } from "@/lib/sample";
import type { HealthView, SessionView } from "@/lib/types";
import type { EditorPrefs } from "./CodeEditor";
import { Console, type ConsoleTab } from "./Console";
import { DiagnosisPanel } from "./DiagnosisPanel";
import { InputPanel, type InputState } from "./InputPanel";
import { Timeline } from "./Timeline";
import { TopBar } from "./TopBar";

const INITIAL: InputState = { source: SAMPLE_SOURCE, bugReport: SAMPLE_BUG, expectedBehavior: "", notes: "", stdin: "", userTests: "" };
const PREFS_KEY = "patchpilot.prefs";
type Section = "input" | "timeline" | "patch" | "console";
const SECTIONS: { id: Section; label: string }[] = [
  { id: "input", label: "Input" },
  { id: "timeline", label: "Timeline" },
  { id: "patch", label: "Patch" },
  { id: "console", label: "Console" },
];

function validate(v: InputState): Record<string, string> {
  const e: Record<string, string> = {};
  if (!v.source.trim()) e.source = "Python source code is required.";
  else if (v.source.length > LIMITS.maxSourceChars) e.source = `Source is limited to ${LIMITS.maxSourceChars} characters.`;
  if (v.bugReport.trim().length < 10) e.bugReport = "Describe the bug in at least 10 characters.";
  else if (v.bugReport.length > LIMITS.maxBugChars) e.bugReport = `Limited to ${LIMITS.maxBugChars} characters.`;
  if (v.expectedBehavior.length > LIMITS.maxExpectedChars) e.expectedBehavior = `Limited to ${LIMITS.maxExpectedChars} characters.`;
  return e;
}

export default function Workspace() {
  const [input, setInput] = useState<InputState>(INITIAL);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [session, setSession] = useState<SessionView | null>(null);
  const [health, setHealth] = useState<HealthView | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [tab, setTab] = useState<ConsoleTab>("orig");
  const [section, setSection] = useState<Section>("input");
  const [prefs, setPrefsState] = useState<EditorPrefs>({ fontSize: 13, wordWrap: false });
  const [starting, setStarting] = useState(false);
  const submitting = useRef(false);
  const pollToken = useRef(0);

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth({ ok: false, groq: { configured: false, model: null }, sandbox: { configured: false, provider: "unknown" }, mode: "unavailable" }));
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (raw) {
        const p = JSON.parse(raw) as Partial<EditorPrefs>;
        setPrefsState({ fontSize: Math.min(20, Math.max(11, Number(p.fontSize) || 13)), wordWrap: !!p.wordWrap });
      }
    } catch { /* storage unavailable: defaults are fine */ }
  }, []);

  const setPrefs = (p: EditorPrefs) => {
    setPrefsState(p);
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* ignore */ }
  };

  const running = starting || session?.status === "running";

  const poll = useCallback(async (id: string) => {
    const token = ++pollToken.current;
    let failures = 0;
    for (;;) {
      await new Promise((r) => setTimeout(r, 700));
      if (token !== pollToken.current) return;
      try {
        const s = await api.get(id);
        if (token !== pollToken.current) return;
        failures = 0;
        setSession(s);
        if (s.status !== "running") return;
      } catch (e) {
        if (e instanceof ApiRequestError && e.code === "NOT_FOUND") {
          setBanner(e.message);
          return;
        }
        if (++failures >= 5) {
          setBanner("Lost contact with the server while the investigation was running.");
          return;
        }
      }
    }
  }, []);

  const submit = async () => {
    if (submitting.current || running) return;
    const errs = validate(input);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    submitting.current = true;
    setStarting(true);
    setBanner(null);
    setSession(null);
    setTab("orig");
    setSection("timeline");
    try {
      const s = await api.start({
        source: input.source,
        bugReport: input.bugReport.trim(),
        ...(input.expectedBehavior.trim() && { expectedBehavior: input.expectedBehavior.trim() }),
        ...(input.notes.trim() && { notes: input.notes.trim() }),
        ...(input.stdin && { stdin: input.stdin }),
        ...(input.userTests.trim() && { userTests: input.userTests }),
      });
      setSession(s);
      void poll(s.id);
    } catch (e) {
      if (e instanceof ApiRequestError && e.fields) setErrors(e.fields);
      setBanner(e instanceof Error ? e.message : "Could not start the investigation.");
      setSection("input");
    } finally {
      submitting.current = false;
      setStarting(false);
    }
  };

  const retry = async () => {
    if (!session || submitting.current) return;
    submitting.current = true;
    try {
      const s = await api.retry(session.id);
      setSession(s);
      void poll(s.id);
    } catch (e) {
      setBanner(e instanceof Error ? e.message : "Retry failed.");
    } finally {
      submitting.current = false;
    }
  };

  const reset = () => {
    pollToken.current++;
    setSession(null);
    setBanner(null);
    setErrors({});
    setTab("orig");
  };
  const newSession = () => {
    reset();
    setInput(INITIAL);
    setSection("input");
  };

  const show = (s: Section) => (section === s ? "flex" : "hidden") + " lg:flex";

  return (
    <div className="flex h-dvh flex-col">
      <TopBar health={health} onNew={newSession} prefs={prefs} setPrefs={setPrefs} busy={!!running} />
      {banner && (
        <div role="alert" className="flex items-center justify-between gap-3 border-b border-danger/40 bg-danger/10 px-3 py-1.5 text-[12px] text-danger">
          <span>{banner}</span>
          <button onClick={() => setBanner(null)} className="underline">Dismiss</button>
        </div>
      )}
      {health?.mode === "preview" && (
        <div className="border-b border-warn/30 bg-warn/10 px-3 py-1 text-[11.5px] text-warn">
          Preview mode: no sandbox is configured. PatchPilot will propose a patch but will not execute anything or verify it.
        </div>
      )}
      <nav className="flex border-b border-line bg-surface lg:hidden" role="tablist" aria-label="Workspace sections">
        {SECTIONS.map((s) => (
          <button key={s.id} role="tab" aria-selected={section === s.id} onClick={() => setSection(s.id)} className={`flex-1 border-b-2 py-2 text-[12px] ${section === s.id ? "border-accent text-ink" : "border-transparent text-ink-faint"}`}>
            {s.label}
          </button>
        ))}
      </nav>
      <main className="grid min-h-0 flex-1 gap-px bg-line lg:grid-cols-[minmax(340px,1.15fr)_minmax(230px,0.55fr)_minmax(360px,1.3fr)] lg:grid-rows-[minmax(0,1fr)_minmax(0,0.62fr)]">
        <div className={`${show("input")} min-h-0 flex-col lg:row-span-1`}>
          <InputPanel value={input} onChange={setInput} errors={errors} running={!!running} onSubmit={submit} prefs={prefs} />
        </div>
        <div className={`${show("timeline")} min-h-0 flex-col`}>
          <Timeline session={session} onJump={(t) => { setTab(t); setSection("console"); }} />
        </div>
        <div className={`${show("patch")} min-h-0 flex-col lg:row-span-2`}>
          <DiagnosisPanel session={session} prefs={prefs} onReset={reset} onRetry={retry} retrying={!!running} />
        </div>
        <div className={`${show("console")} min-h-0 flex-col lg:col-span-2`}>
          <Console session={session} tab={tab} setTab={setTab} />
        </div>
      </main>
    </div>
  );
}
