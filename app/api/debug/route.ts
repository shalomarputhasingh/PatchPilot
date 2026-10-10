import { errorResponse, json } from "@/lib/api";
import { getConfig } from "@/lib/config";
import { runWorkflow } from "@/lib/engine";
import { debugRequestSchema, validateRequestFields } from "@/lib/schemas";
import { createSession, toView } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return errorResponse(400, "INVALID_JSON", "Request body must be valid JSON.");
  }
  const parsed = debugRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[String(issue.path[0] ?? "request")] ??= issue.message;
    return errorResponse(400, "INVALID_REQUEST", "The request is invalid.", fields);
  }
  const fields = validateRequestFields(parsed.data);
  if (Object.keys(fields).length) return errorResponse(400, "INVALID_REQUEST", "The request is invalid.", fields);

  const cfg = getConfig();
  if (!cfg.groq.configured) {
    return errorResponse(503, "NOT_CONFIGURED", "Groq is not configured. Set GROQ_API_KEY and GROQ_MODEL on the server.");
  }
  const mode = cfg.sandbox.configured ? "full" : "preview";
  const session = createSession(parsed.data, mode);
  if (!session) return errorResponse(429, "TOO_MANY_SESSIONS", "The server is busy with other investigations. Try again shortly.");

  // Fire and forget: the client polls GET /api/debug/[id]. Requires a long-lived Node server.
  void runWorkflow(session);
  return json(toView(session), 202);
}
