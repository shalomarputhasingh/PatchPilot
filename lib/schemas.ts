import { z } from "zod";
import { LIMITS } from "./limits";

export const debugRequestSchema = z.object({
  source: z.string().max(LIMITS.maxSourceChars, `Source must be at most ${LIMITS.maxSourceChars} characters`),
  bugReport: z.string().max(LIMITS.maxBugChars),
  expectedBehavior: z.string().max(LIMITS.maxExpectedChars).optional(),
  notes: z.string().max(LIMITS.maxNotesChars).optional(),
  stdin: z.string().max(LIMITS.maxStdinChars).optional(),
  userTests: z.string().max(LIMITS.maxUserTestsChars).optional(),
});

/** Field-level validation beyond size caps. Returns a map of field -> message. */
export function validateRequestFields(r: z.infer<typeof debugRequestSchema>): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!r.source.trim()) errors.source = "Python source code is required.";
  else if (r.source.includes("\0")) errors.source = "Source contains NUL bytes.";
  if (r.bugReport.trim().length < 10) errors.bugReport = "Describe the bug in at least 10 characters.";
  return errors;
}

const jsonValue: z.ZodType<unknown> = z.unknown();

export const regressionTestSchema = z.object({
  name: z.string().min(1).max(200),
  function: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "must be a Python identifier"),
  args: z.array(jsonValue).max(10).default([]),
  kwargs: z.record(z.string(), jsonValue).default({}),
  expected: jsonValue,
  rationale: z.string().max(500).optional(),
});

export const modelPatchSchema = z.object({
  summary: z.string().min(1).max(1000),
  rootCause: z.string().min(1).max(2000),
  reasoning: z.string().min(1).max(3000),
  unifiedDiff: z.string().min(1).max(LIMITS.maxPatchChars),
  affectedLines: z.array(z.number().int().positive()).max(200).default([]),
  edgeCases: z.array(z.string().max(500)).max(10).default([]),
  regressionTests: z.array(regressionTestSchema).max(LIMITS.maxGeneratedTests).default([]),
  limitations: z.array(z.string().max(500)).max(10).default([]),
});
export type ModelPatch = z.infer<typeof modelPatchSchema>;

/** Repair responses may omit tests; if present they replace nothing (tests are fixed after round 1). */
export const modelRepairSchema = modelPatchSchema.partial({ regressionTests: true, summary: true, rootCause: true, edgeCases: true });
