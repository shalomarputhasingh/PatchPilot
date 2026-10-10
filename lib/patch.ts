import { createTwoFilesPatch, structuredPatch } from "diff";
import { LIMITS } from "./limits";

export const SOURCE_FILENAME = "solution.py";

export type PatchResult =
  | { ok: true; newSource: string; diff: string; added: number; removed: number }
  | { ok: false; error: string };

interface Hunk {
  hintStart: number; // 0-based index in original
  old: string[];
  next: string[];
}

/** Strip markdown fences / BOM and normalize newlines. Model output is untrusted text. */
function clean(diff: string): string {
  let d = diff.replace(/^﻿/, "").replace(/\r\n/g, "\n").trim();
  const fence = d.match(/^```[a-zA-Z]*\n([\s\S]*?)\n```$/);
  if (fence?.[1]) d = fence[1];
  return d;
}

export function parseUnifiedDiff(raw: string): { hunks: Hunk[] } | { error: string } {
  const lines = clean(raw).split("\n");
  const hunks: Hunk[] = [];
  let cur: Hunk | null = null;
  let oldHeaders = 0;
  let newHeaders = 0;
  let sawHunkHeader = false;

  for (const line of lines) {
    if (line.startsWith("diff --git") || line.startsWith("Index: ")) {
      if (sawHunkHeader) return { error: "Patch touches more than one file." };
      continue;
    }
    if (!cur || line.startsWith("@@")) {
      if (line.startsWith("--- ")) {
        if (++oldHeaders > 1) return { error: "Patch touches more than one file." };
        if (line.includes("/dev/null")) return { error: "Patch may not create files." };
        continue;
      }
      if (line.startsWith("+++ ")) {
        if (++newHeaders > 1) return { error: "Patch touches more than one file." };
        if (line.includes("/dev/null")) return { error: "Patch may not delete files." };
        continue;
      }
    }
    const header = line.match(/^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/);
    if (header) {
      sawHunkHeader = true;
      cur = { hintStart: Math.max(0, Number(header[1]) - 1), old: [], next: [] };
      hunks.push(cur);
      continue;
    }
    if (!cur) {
      if (line.trim() === "") continue;
      return { error: `Unexpected content before first hunk: "${line.slice(0, 60)}"` };
    }
    if (line.startsWith("\\")) continue; // "\ No newline at end of file"
    const tag = line[0];
    const body = line.slice(1);
    if (tag === " ") {
      cur.old.push(body);
      cur.next.push(body);
    } else if (tag === "-") {
      cur.old.push(body);
    } else if (tag === "+") {
      cur.next.push(body);
    } else if (line === "") {
      // Models often drop the single space of an empty context line.
      cur.old.push("");
      cur.next.push("");
    } else {
      return { error: `Malformed hunk line: "${line.slice(0, 60)}"` };
    }
  }

  if (hunks.length === 0) return { error: "Patch contains no hunks (@@ -a,b +c,d @@)." };
  for (const h of hunks) {
    if (h.old.length === h.next.length && h.old.every((l, i) => l === h.next[i])) {
      return { error: "A hunk contains no changes." };
    }
  }
  return { hunks };
}

const eq = (a: string, b: string) => a === b || a.trimEnd() === b.trimEnd();

function findHunk(orig: string[], old: string[], hint: number, minStart: number): number | string {
  const matchesAt = (i: number) => {
    if (i < minStart || i + old.length > orig.length) return false;
    for (let k = 0; k < old.length; k++) if (!eq(orig[i + k]!, old[k]!)) return false;
    return true;
  };
  if (old.length === 0) return "Hunk has no context or removed lines to anchor it.";
  if (matchesAt(hint)) return hint;
  const found: number[] = [];
  for (let i = minStart; i + old.length <= orig.length; i++) if (matchesAt(i)) found.push(i);
  if (found.length === 1) return found[0]!;
  if (found.length === 0) return "Hunk context does not match the submitted source (the patch was not made against this exact version).";
  return "Hunk context matches several locations; it is ambiguous.";
}

export function applyPatch(original: string, rawDiff: string): PatchResult {
  if (rawDiff.length > LIMITS.maxPatchChars) return { ok: false, error: "Patch is too large." };
  const parsed = parseUnifiedDiff(rawDiff);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const normalized = original.replace(/\r\n/g, "\n");
  const endsNl = normalized.endsWith("\n");
  const orig = (endsNl ? normalized.slice(0, -1) : normalized).split("\n");

  const out: string[] = [];
  let cursor = 0;
  for (const h of parsed.hunks) {
    const pos = findHunk(orig, h.old, h.hintStart, cursor);
    if (typeof pos === "string") return { ok: false, error: pos };
    out.push(...orig.slice(cursor, pos), ...h.next);
    cursor = pos + h.old.length;
  }
  out.push(...orig.slice(cursor));
  const newSource = out.join("\n") + (endsNl ? "\n" : "");

  if (!newSource.trim()) return { ok: false, error: "Patched source would be empty." };
  if (newSource.length > LIMITS.maxSourceChars) return { ok: false, error: "Patched source exceeds the size limit." };
  if (newSource === normalized) return { ok: false, error: "Patch makes no change to the source." };

  const sp = structuredPatch(SOURCE_FILENAME, SOURCE_FILENAME, normalized, newSource, "", "", { context: 3 });
  let added = 0;
  let removed = 0;
  for (const hunk of sp.hunks) for (const l of hunk.lines) (l.startsWith("+") ? added++ : l.startsWith("-") ? removed++ : 0);

  const nonEmpty = orig.filter((l) => l.trim()).length;
  if (nonEmpty > 8 && removed / orig.length > 0.8) {
    return { ok: false, error: "Patch rewrites nearly the whole file; a minimal change is required." };
  }

  const diff = createTwoFilesPatch(`a/${SOURCE_FILENAME}`, `b/${SOURCE_FILENAME}`, normalized, newSource, "", "", { context: 3 });
  return { ok: true, newSource, diff, added, removed };
}
