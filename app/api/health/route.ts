import { getConfig } from "@/lib/config";
import { json } from "@/lib/api";
import type { HealthView } from "@/lib/types";

export const dynamic = "force-dynamic";

export function GET() {
  const c = getConfig();
  const mode = !c.groq.configured ? "unavailable" : c.sandbox.configured ? "full" : "preview";
  const body: HealthView = {
    ok: mode !== "unavailable",
    groq: { configured: c.groq.configured, model: c.groq.configured ? c.groq.model : null },
    sandbox: { configured: c.sandbox.configured, provider: c.sandbox.provider },
    mode,
  };
  return json(body);
}
