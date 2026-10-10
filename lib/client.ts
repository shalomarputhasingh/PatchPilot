import type { ApiError, DebugRequest, HealthView, SessionView } from "./types";

export class ApiRequestError extends Error {
  constructor(message: string, public code: string, public fields?: Record<string, string>) {
    super(message);
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, cache: "no-store" });
  } catch {
    throw new ApiRequestError("Could not reach the PatchPilot server.", "NETWORK");
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) {
    const e = (body as ApiError | null)?.error;
    throw new ApiRequestError(e?.message ?? `Request failed (HTTP ${res.status}).`, e?.code ?? "HTTP_ERROR", e?.fields);
  }
  return body as T;
}

export const api = {
  health: () => call<HealthView>("/api/health"),
  start: (r: DebugRequest) =>
    call<SessionView>("/api/debug", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(r) }),
  get: (id: string) => call<SessionView>(`/api/debug/${id}`),
  retry: (id: string) => call<SessionView>(`/api/debug/${id}/retry`, { method: "POST" }),
};

export function download(filename: string, text: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
