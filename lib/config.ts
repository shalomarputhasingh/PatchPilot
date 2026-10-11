import "server-only";

/** Server-side configuration. Never import from client components. */
export function getConfig() {
  const groqKey = process.env.GROQ_API_KEY?.trim() ?? "";
  const groqModel = process.env.GROQ_MODEL?.trim() ?? "";
  const sandboxUrl = process.env.SANDBOX_API_URL?.trim() ?? "";
  const sandboxKey = process.env.SANDBOX_API_KEY?.trim() ?? "";
  // A custom URL implies Piston unless told otherwise; with no URL the default is RapidAPI SandboxAPI.
  const sandboxProvider = (process.env.SANDBOX_PROVIDER?.trim() || (sandboxUrl ? "piston" : "rapidapi")).toLowerCase();
  return {
    groq: {
      apiKey: groqKey,
      model: groqModel,
      baseURL: process.env.GROQ_BASE_URL?.trim() || undefined,
      configured: Boolean(groqKey && groqModel),
    },
    sandbox: {
      provider: sandboxProvider,
      url: sandboxUrl.replace(/\/+$/, ""),
      apiKey: sandboxKey,
      runTimeoutMs: intEnv("SANDBOX_RUN_TIMEOUT_MS", 10_000, 1_000, 60_000),
      configured: sandboxProvider === "rapidapi" ? Boolean(sandboxKey) : Boolean(sandboxUrl),
    },
    sessionBudgetMs: intEnv("SESSION_BUDGET_MS", 150_000, 10_000, 600_000),
  };
}

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(process.env[name] ?? "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
