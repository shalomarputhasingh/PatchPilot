import { errorResponse, json } from "@/lib/api";
import { getSession, toView } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await ctx.params;
  const s = getSession(sessionId);
  if (!s) return errorResponse(404, "NOT_FOUND", "Session not found (it may have expired or the server restarted).");
  return json(toView(s));
}
