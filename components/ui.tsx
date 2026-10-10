import type { FinalStatus } from "@/lib/types";
import { AlertTriangle, CheckCircle2, CircleDashed, HelpCircle, SearchX, XCircle } from "lucide-react";

export function Panel({ title, right, children, className = "" }: { title: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`flex min-h-0 flex-col border border-line bg-surface ${className}`}>
      <header className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-line px-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-dim">{title}</h2>
        {right}
      </header>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </section>
  );
}

export const STATUS_META: Record<FinalStatus, { label: string; tone: string; Icon: typeof CheckCircle2 }> = {
  VERIFIED: { label: "Verified", tone: "text-accent border-accent/40 bg-accent/10", Icon: CheckCircle2 },
  PARTIALLY_VERIFIED: { label: "Partially verified", tone: "text-warn border-warn/40 bg-warn/10", Icon: AlertTriangle },
  UNVERIFIED: { label: "Unverified", tone: "text-ink-dim border-line-strong bg-surface-2", Icon: HelpCircle },
  FAILED: { label: "Failed", tone: "text-danger border-danger/40 bg-danger/10", Icon: XCircle },
  BASELINE_NOT_REPRODUCED: { label: "Bug not reproduced", tone: "text-cyan border-cyan/40 bg-cyan/10", Icon: SearchX },
};

export function StatusBadge({ status }: { status: FinalStatus }) {
  const m = STATUS_META[status];
  return (
    <span className={`inline-flex items-center gap-1.5 border px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wide ${m.tone}`}>
      <m.Icon size={12} aria-hidden /> {m.label}
    </span>
  );
}

export function Tag({ tone, children }: { tone: "ok" | "bad" | "warn" | "mute" | "info"; children: React.ReactNode }) {
  const t = {
    ok: "text-accent border-accent/40",
    bad: "text-danger border-danger/40",
    warn: "text-warn border-warn/40",
    mute: "text-ink-faint border-line-strong",
    info: "text-cyan border-cyan/40",
  }[tone];
  return <span className={`inline-flex items-center border px-1.5 py-px font-mono text-[10px] uppercase tracking-wide ${t}`}>{children}</span>;
}

export const Pending = CircleDashed;

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="p-4 text-[12px] leading-relaxed text-ink-faint">{children}</p>;
}
