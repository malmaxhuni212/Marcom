# MARCOM Product Specification

## System Definition
MARCOM (Multi-Agent Researcher Communicator) is a project-independent AI research and communications system. It converts a human project brief into structured instructions, researches relevant prospects, creates personalized outreach, and keeps the human firmly in control of the final output.

## Core Workflow
1. **Human** → Creates a Project Brief
2. **Brief Analyzer** → Converts into a Structured Brief
3. **Research Agent** → Executes research based on structured brief
4. **Research QA** → Validates research quality and constraints
5. **Personalization Agent** → Generates tailored outreach drafts
6. **Personalization QA** → Validates outreach against brand and project rules
7. **Human Review** → Mandatory approval process
8. **Outreach / Follow-up** → Execution and tracking
9. **Memory / Learning** → System records outcomes to inform future actions

## Core Agents & Strict Boundaries

### AGENT 1 — BRIEF ANALYZER
**Mission:** 
Convert a human project brief into an executable structured brief.

**Strict Boundaries:**
- Does **not** perform external research.
- Does **not** write outreach messages.

### AGENT 2 — RESEARCH AGENT / SCOUT
**Mission:** 
Find, investigate, verify and structure relevant people or organizations according to the project requirements.

**Strict Boundaries:**
- Does **not** write outreach messages.
- Does **not** invent or hallucinate information.
- Does **not** use private or sensitive information.

### AGENT 3 — PERSONALIZATION AGENT / TAILOR
**Mission:** 
Use verified research, project context, and relevant relationship history to create genuinely relevant outreach.

**Strict Boundaries:**
- Does **not** perform broad prospect discovery or research.
- Does **not** invent personal details or assumptions.
- Does **not** use unsupported or forced personalization.

## Human Control
- **Mandatory Review**: Human review is mandatory before any outreach is sent or finalized.
- **Approval Actions**: The human can approve, edit, or reject outreach drafts.
- **Iteration**: The human can request more research or adjust project parameters at any time.

## Project Independence
Every important behavior must be derived from the active project's structured brief. The system must not rely on hardcoded assumptions (e.g., assuming the user is always looking for authors or filmmakers). The project determines what MARCOM is currently working on.
