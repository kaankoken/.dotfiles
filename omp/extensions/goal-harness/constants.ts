export const DEFAULT_GOAL = [
  "1. No errors, warnings, test failures",
  "2. No warning suppressions in production (tests OK)",
  "3. Everything wired — no stubs/TODO/TBD/FIXME",
  "4. Always use project skill set (rust-skills, axiom, …)",
  "5. Always latest deps — check web, don't trust training/context-mode",
  "6. Do all tasks from superpowers specs & plans",
  "7. Specs/plans always tracked in bd (SoT)",
].join("\n");

/** Bind /harness args: empty → DEFAULT_GOAL; otherwise exact args (preserve spaces). */
export const bindGoal = (args: string): string =>
  args.length === 0 ? DEFAULT_GOAL : args;

export const HARNESS_COMMAND_NAME = "harness" as const;
