import { errorResponse, json } from "@/lib/api";
import { retryEligible, runRetry } from "@/lib/engine";
import { getSession, toView } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(_req: Request, ctx: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await ctx.params;
  const s = getSession(sessionId);
  if (!s) return errorResponse(404, "NOT_FOUND", "Session not found.");
  if (s.running) return errorResponse(409, "BUSY", "This session is already running.");
  if (!retryEligible(s)) {
    return errorResponse(409, "NOT_ELIGIBLE", "No further repair attempt is allowed for this session.");
  }
  s.running = true; // synchronous lock before any await
  void runRetry(s);
  return json(toView(s), 202);
}
