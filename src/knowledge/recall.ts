// `recall` — v1 stub (FR-049, plan.md binding condition 1).
//
// It refuses and returns nothing. A half-tuned ranker returning plausible-but-wrong records is the
// failure that removed two tools from this repository in July 2026 (Principle II). A ranker ships
// only after it clears a bar registered before it was built, measured in bench/ (tasks.md T075–T078).

export const RECALL_REFUSAL =
  "not implemented: free-text recall ships only after a ranker clears its measured bar (FR-049). " +
  "Ask about a path or symbol instead: enou why <path-or-symbol>";
