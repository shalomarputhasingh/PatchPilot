export const LIMITS = {
  maxSourceChars: 20_000,
  maxBugChars: 2_000,
  maxExpectedChars: 1_000,
  maxNotesChars: 1_000,
  maxStdinChars: 2_000,
  maxUserTestsChars: 8_000,
  maxPatchChars: 30_000,
  maxOutputChars: 20_000,
  maxGeneratedTests: 8,
  /** Repair attempts allowed after the initial proposed patch. Enforced server-side. */
  maxRepairAttempts: 2,
} as const;
