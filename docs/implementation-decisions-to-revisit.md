# Implementation Decisions to Revisit

This note records parts of the current prototype that work but need another design review before they are treated as final product behaviour.

## 1. Focused research for each selected prospect

### Current behaviour

When automatic discovery is used, the system performs:

1. one broad Exa search to discover possible prospects;
2. Groq selects supported prospects from those search results;
3. a second, focused Exa search runs for every selected prospect;
4. Groq converts the focused search evidence into a research record.

For example, requesting ten prospects can produce one discovery search followed by up to ten focused research searches.

### What needs to be revisited

- Decide whether every selected prospect always requires a second Exa search.
- Determine when evidence from the discovery search can be reused safely.
- Define the minimum evidence required before focused research can be skipped.
- Set per-prospect source limits, query limits, timeout behaviour, and cost limits.
- Decide how partial results should be handled when some prospect searches fail.
- Confirm how progress, provider usage, and estimated cost should be presented to the user.
- Ensure batch research remains bounded and can be resumed without duplicating searches or prospects.

### Desired outcome

A documented research policy that balances evidence quality, search cost, processing time, and predictable batch behaviour.

## 2. Reviewing campaign configuration as raw JSON

### Current behaviour

After Groq analyses a brief, the interface shows the original brief beside the generated `StructuredBrief` JSON. The user edits the JSON directly and approves it to create the project.

### What needs to be revisited

- Replace raw JSON editing with an understandable structured form for non-technical users.
- Organise the form into project objective, target groups, geography, qualification criteria, exclusions, research fields, preferred sources, outreach rules, unknowns, and conflicts.
- Keep the original brief visible while the user reviews the extracted configuration.
- Clearly mark required fields, AI-inferred values, missing information, warnings, and blocking unknowns.
- Allow target groups, criteria, fields, and exclusions to be added, removed, and reordered.
- Keep an optional advanced JSON view for technical troubleshooting if it remains useful.
- Validate the final edited configuration with the same Zod and semantic validators before saving it.
- Prevent project creation when required search configuration is missing or invalid.
- Decide how configuration drafts, approval, and later revisions should be versioned.

### Desired outcome

A human review experience that lets a non-technical team member understand and correct the campaign configuration without editing JSON, while preserving strict server-side validation.
