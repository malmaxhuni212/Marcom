# Brief Analyzer — Agent-Specific Rules

These extend `agents/shared/global-rules.md`. Rules marked **[enforced]** are checked deterministically by
`src/marcom/validation/brief-validator.ts`; an output that violates them is rejected.

## Scope
1. Do not research. Do not name prospects. Do not draft messages.
2. Do not add domain assumptions. If the brief does not mention films, books, startups, AI, investors, sponsors or partnerships, none of those words should appear in your output. *(measured by the evaluation harness: reusability)*

## Fidelity
3. **[enforced]** Never introduce a number (threshold, count, date, size, budget) that does not appear in the brief.
4. **[enforced]** Any quote you include (`unknowns[].quote`, `conflicts[].quotes`, `approximations[].quote`) must appear verbatim in the brief.
5. **[enforced]** A criterion containing a vague term (influential, top, leading, major, big, best, well-known, high-profile, prominent, established, successful, reputable, popular, notable, …) must have `needs_operational_definition: true`.
6. **[enforced]** If the brief contains approximate statements, `approximations` must not be empty.
7. **[enforced]** `outreach.approval_required` is always `true`.
8. **[enforced]** Target ids are unique within a brief.
9. **[enforced]** Output conforms exactly to schema version `1.0` (no extra keys, no missing keys).

## Judgement
10. One target group per distinct set of criteria. Different groups → different entries.
11. `origin: "inferred"` is allowed only for conservative, directly implied criteria (e.g. "Berlin-based" implies geography Berlin). Never infer a threshold.
12. Exclusions referencing data that was not supplied (e.g. "our existing clients (list to be supplied)") must also produce an unknown.
13. Industry shorthand that could be interpreted in several ways (e.g. "big five", "tier one") should be confirmed via an unknown.
14. When the brief is too thin to act on, it is correct to return mostly unknowns with `blocking: true`. A sparse honest brief beats a rich invented one.
15. Do not resolve conflicts. Report them.

## Structured brief input
The brief may arrive as a structured form with labelled sections (Project Overview, Goals and Objectives, Target Audience and Focus, What Needs to Be Done, Important Context and Constraints, Additional Information), optionally followed by a SUPPORTING MATERIAL block.
16. Interpret all sections together as one brief. Do not map a section to a single output field; information relevant to targets, exclusions, personalisation or outreach can appear in any section.
17. Sections marked `(not provided)` or answered with phrases such as "Not decided yet", "TBD" or "unknown" carry no information. Never fill them with assumptions; record an unknown only if the missing information is needed for research.
18. The user's own section answers are authoritative. SUPPORTING MATERIAL may add detail but must never override them. If supporting material contradicts a user answer, report it in `conflicts` with verbatim quotes from both.
19. If the project name is marked as not provided, set `project.name` to a short, neutral name derived only from the brief's content.
