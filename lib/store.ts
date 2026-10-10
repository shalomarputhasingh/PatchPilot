import "server-only";
import { randomUUID } from "node:crypto";
import type { DebugRequest, SessionView, StepInfo } from "./types";

export interface InternalSession extends SessionView {
  request: DebugRequest;
  /** Synchronous lock: set before any await so concurrent calls cannot double-run a session. */
  running: boolean;
  deadline: number;
}

export const STEP_DEFS: Pick<StepInfo, "id" | "label">[] = [
  { id: "input", label: "Input validated" },
  { id: "baseline", label: "Original code executed" },
  { id: "analysis", label: "Failure analyzed" },
  { id: "patch", label: "Patch generated" },
  { id: "validate", label: "Patch validated" },
  { id: "repaired", label: "Repaired code executed" },
  { id: "tests", label: "Regression tests evaluated" },
  { id: "final", label: "Final result prepared" },
];

const MAX_SESSIONS = 200;
const MAX_CONCURRENT = 4;
const TTL_MS = 60 * 60 * 1000;

const g = globalThis as unknown as { __patchpilotSessions?: Map<string, InternalSession> };
const sessions = (g.__patchpilotSessions ??= new Map<string, InternalSession>());

function sweep() {
  const now = Date.now();
  for (const [id, s] of sessions) if (!s.running && now - s.createdAt > TTL_MS) sessions.delete(id);
  while (sessions.size > MAX_SESSIONS) {
    const oldest = sessions.keys().next().value;
    if (oldest === undefined) break;
    sessions.delete(oldest);
  }
}

export function runningCount(): number {
  let n = 0;
  for (const s of sessions.values()) if (s.running) n++;
  return n;
}

export function createSession(request: DebugRequest, mode: "full" | "preview"): InternalSession | null {
  sweep();
  if (runningCount() >= MAX_CONCURRENT) return null;
  const s: InternalSession = {
    id: randomUUID(),
    status: "running",
    mode,
    createdAt: Date.now(),
    steps: STEP_DEFS.map((d) => ({ ...d, state: "pending" as const })),
    originalSource: request.source,
    regressionTests: [],
    attempts: [],
    repairAttemptsUsed: 0,
    canRetry: false,
    notices: [],
    request: Object.freeze({ ...request }),
    running: true,
    deadline: 0,
  };
  sessions.set(s.id, s);
  return s;
}

export function getSession(id: string): InternalSession | undefined {
  return sessions.get(id);
}

export function toView(s: InternalSession): SessionView {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { request, running, deadline, ...view } = s;
  return view;
}
