import { readFileSync } from "node:fs";
import path from "node:path";

export interface Excerpt {
  title: string;
  file: string;
  code: string;
}

/**
 * Pulls a contiguous block of real source lines: from the first line matching `start`
 * to the first following line matching `end` (inclusive). Nothing is retyped, so the
 * report always shows the project's actual code.
 */
function extract(file: string, start: RegExp, end: RegExp): string {
  const lines = readFileSync(path.join(/*turbopackIgnore: true*/ process.cwd(), file), "utf8").split("\n");
  const from = lines.findIndex((l) => start.test(l));
  if (from < 0) throw new Error(`report: start marker not found in ${file}`);
  const to = lines.findIndex((l, i) => i > from && end.test(l));
  if (to < 0) throw new Error(`report: end marker not found in ${file}`);
  const block = lines.slice(from, to + 1);
  const indent = Math.min(...block.filter((l) => l.trim()).map((l) => l.match(/^ */)![0].length));
  return block.map((l) => l.slice(indent)).join("\n");
}

export function getExcerpts(): Excerpt[] {
  return [
    {
      title: "1. Backend entry point: starting a debugging session",
      file: "app/api/debug/route.ts",
      code: extract("app/api/debug/route.ts", /^export async function POST/, /^}$/),
    },
    {
      title: "2. Interface logic: submitting a bug report and polling its progress",
      file: "components/Workspace.tsx",
      code: extract("components/Workspace.tsx", /^ {2}const submit = async/, /^ {2}};$/),
    },
    {
      title: "3. Validated model call with a single re-ask on malformed output",
      file: "lib/groq.ts",
      code: extract("lib/groq.ts", /^\/\*\* Calls the model and validates/, /^}$/),
    },
    {
      title: "4. Patch validation: locating each hunk in the analysed source",
      file: "lib/patch.ts",
      code: extract("lib/patch.ts", /^const eq = /, /^}$/),
    },
    {
      title: "5. Deterministic check that decides whether a repair attempt failed",
      file: "lib/verdict.ts",
      code: extract("lib/verdict.ts", /^export const failed = /, /^}$/),
    },
  ];
}
