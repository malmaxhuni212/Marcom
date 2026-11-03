# MARCOM Automation — Comprehensive Project Handover Document

> **Document Version:** 1.0.0  
> **Repository:** `Lunim-Corporate/marcom-automation`  
> **Active Branch:** `dev_mal` (tracked with `origin/dev_mal`)  
> **Latest Commit:** `c92f55a`  
> **Last Updated:** October 28, 2026  

---

## 1. Executive Summary & Vision

**MARCOM** (*Multi-Agent Researcher Communicator*) is a project-independent autonomous AI research and B2B communications platform developed for **Lunim Corporate** and its diverse initiative portfolio (e.g. *Maya Book Awards*, *FlowPilot Automation*, and corporate communications).

### Core Problem Solved
Traditional cold outreach and SDR tools suffer from hallucinations, generic template spam, superficial scraping, and low conversion rates. MARCOM replaces this with:
- **Evidence-Grounded Prospecting:** Every prospect attribute, verified quote, and hook cites an explicit public URL discovered via neural search.
- **Strict Separation of Concerns:** Models never multitask. An agent that synthesizes briefs never conducts search; an agent that researches never drafts outreach copy.
- **Deterministic Enforcement over LLM Trust:** Zod schemas, character bounds, deliverability verifications, and blacklisted buzzword filters run in deterministic TypeScript code, never relying on LLM self-policing.
- **Human-in-the-Loop Governance:** Autonomous agents prepare candidate campaigns, prospects, and personalized drafts, but a human must review and approve before any communication is dispatched.

---

## 2. Technology Stack & Key Dependencies

| Layer | Technology | Details / Notes |
| :--- | :--- | :--- |
| **Framework** | Next.js 16.3.8 (App Router) | High-performance React framework; runs locally on `127.0.0.1:3000`. |
| **UI & Styling** | React 19.2.8 + Tailwind CSS v4 | Dark cinematic UI (`#08080c` palette, glassmorphism, cyan/emerald accents). |
| **Language** | TypeScript 5.8 | Strict type checking (`tsc --noEmit`). |
| **Database** | PostgreSQL (Neon / Serverless) | Authoritative source of truth for all projects, research jobs, and prospects. |
| **ORM & Migrations** | Drizzle ORM + Drizzle Kit | Migrations tracked in `netlify/database/migrations/`. |
| **LLM Inference** | Groq API (`llama-3.3-70b-versatile`) | Fast, low-latency reasoning for brief synthesis and two-stage outreach drafting. |
| **Web Research** | Exa AI API (`@exa-labs/sdk`) | Neural web search for discovering verified individuals, organizations, and source quotes. |
| **Document Ingestion** | `pdf-parse`, `mammoth` (docx), `cheerio` | Extracts and normalizes uploaded briefs, decks, and public Google Docs. |
| **Testing** | Node.js Test Runner + `tsx` | 86 automated unit and integration tests under `src/**/*.test.ts`. |
| **Hosting Target** | Netlify | Next.js Netlify runtime with PostgreSQL integration. |

---

## 3. Architecture & Core Pipelines

```mermaid
flowchart TD
    A[Human Project Brief / Upload] --> B[Brief Analyzer Agent]
    B -->|Prefill Mode| C[4 Intake Questions + Optional Constraints]
    C -->|Human Approval| D[Full Campaign Configuration]
    D -->|PostgreSQL Storage| E[(Projects Table)]
    E --> F[Research Agent / Scout]
    F -->|Exa Neural Search| G[Prospect Discovery & Evidence Extraction]
    G --> H{Research QA Engine}
    H -->|Verified & Deduplicated| I[(Prospects Table)]
    I --> J[Personalization Agent / Tailor]
    J -->|Strategist + Copywriter| K[Personalized Outreach Drafts]
    K --> L{Personalization QA Engine}
    L -->|Strict Bounds Check| M[(Personalizations Table)]
    M --> N[Slide-Over Prospect Inspection Drawer & Human Approval]
```

### 3.1 Agent 1: Brief Analyzer (`src/marcom/agents/brief-analyzer/`)
- **Input:** Raw text, PDF files, Word `.docx`, Markdown, or Google Doc URLs.
- **Workflow Modes:**
  1. `mode: 'prefill'`: Synthesizes the brief into direct answers for the 4 core intake questions plus suggested project name and optional constraints.
  2. Full Synthesis: Produces a fully validated `StructuredBrief` object (objectives, target segments, qualification criteria, negative search terms, and outreach channel preferences).
- **Boundaries:** Does **not** perform external search and does **not** draft outreach copy.

### 3.2 Agent 2: Research Agent / Scout (`src/marcom/agents/research/`)
- **Input:** Validated `StructuredBrief` from active campaign.
- **Engine:** Queries Exa AI neural search engine with domain deduplication, keyword matching, and quote verification.
- **Quality Assurance (`research-qa.ts`):** Validates that every prospect has a real name, role, organization, source URL, and verified quote. Flags bot traps and invalid domains.

### 3.3 Agent 3: Personalization Agent / Tailor (`src/marcom/agents/personalization/`)
- **Input:** Verified prospect profile + project context.
- **Two-Model Chain (Groq):**
  1. *Intelligence Strategist:* Audits communication channels, selects the strongest proof hook, and formulates the outreach strategy.
  2. *Master Copywriter:* Drafts direct, high-conversion copy tailored to the recipient.
- **Strict Guardrails:** Enforces word count bounds, bans buzzwords ("synergy", "game-changer", etc.), and **strictly forbids em-dashes and en-dashes**.

---

## 4. Key Workflows & Recent Implementations

### 4.1 3-Stage Brief Intake & Campaign Setup
Located in [`src/components/ui/BriefIntakeModal.tsx`](file:///c:/Users/Asus/Downloads/marcom-automation-main/marcom-automation-main/src/components/ui/BriefIntakeModal.tsx):
1. **Stage 1 (`UPLOAD`):** User uploads a brief document (PDF, Word, TXT, MD up to 15MB) or enters a Google Doc URL. Alternatively, they can click *"Skip upload & write manually →"*.
2. **Stage 2 (`QUESTIONS`):** The system auto-answers the 4 mandatory questions (`overview`, `goals`, `work`, `audience`) and suggests a project name. The 5th question (`constraints`) is labeled `Optional`. The user reviews, edits, and adds anything. The primary action *"Approve Questions & Configure Campaign →"* is strictly disabled until all 4 mandatory questions are filled.
3. **Stage 3 (`REVIEW`):** Transitions to [`CampaignConfigurationForm.tsx`](file:///c:/Users/Asus/Downloads/marcom-automation-main/marcom-automation-main/src/components/campaign/CampaignConfigurationForm.tsx), displaying every setting (targets, qualification criteria, negative keywords, outreach channels). The user can tweak any configuration or click *"Save campaign"* to persist it to PostgreSQL.

### 4.2 Slide-Over Prospect Inspection Drawer
Located in [`src/components/workspace/views/ProspectsView.tsx`](file:///c:/Users/Asus/Downloads/marcom-automation-main/marcom-automation-main/src/components/workspace/views/ProspectsView.tsx):
- When a user clicks on any prospect in the list, a slide-over modal/drawer opens immediately on screen.
- Users no longer need to scroll to the bottom of the page to inspect prospect information, evidence citations, and generated email drafts.

### 4.4 Reviewer Draft Feedback & Dynamic Rewrites
Located in `src/components/workspace/DraftFeedbackPanel.tsx` and `src/marcom/personalization/feedback.ts`:
- Reviewers provide direct qualitative feedback under any generated outreach draft (quick chips like *"Make it shorter"*, *"Less flattering"*, or custom instructions).
- **Save feedback**: Stores the critique in project memory to condition all future draft generations for that category or project.
- **Save & rewrite**: Incorporates the critique immediately to generate a real-time rewrite via Groq or deterministic fallback.
- Feedback memory is injected into both the Strategist and Writer prompts with scoped relevance.

### 4.3 Campaign Deletion with Full Cascade
Located in [`src/app/api/projects/[id]/route.ts`](file:///c:/Users/Asus/Downloads/marcom-automation-main/marcom-automation-main/src/app/api/projects/[id]/route.ts) and [`src/components/workspace/CampaignSwitcher.tsx`](file:///c:/Users/Asus/Downloads/marcom-automation-main/marcom-automation-main/src/components/workspace/CampaignSwitcher.tsx):
- A permanent, high-visibility "Delete Campaign" button is placed at the bottom right of the campaign switcher menu.
- Deletion cascades cleanly in PostgreSQL, removing associated prospects, personalizations, research jobs, and source files.

---

## 5. Database Schema & Migration Guide

PostgreSQL is the single source of truth. All tables are defined using Drizzle ORM in `src/db/schema/`:

- **`projects` (`projects.ts`):** Stores campaign metadata, structured brief JSON, and configuration revisions.
- **`source_files` (`source-files.ts`):** Stores raw uploaded brief documents and extraction results.
- **`research_jobs` (`research-jobs.ts`):** Tracks background research job status, attempts, and payloads.
- **`prospects` (`prospects.ts`):** Stores verified individuals/organizations, scores, qualification status (`NEEDS_REVIEW`, `APPROVED`, `REJECTED`), and evidence citations.
- **`personalizations` (`personalizations.ts`):** Stores generated outreach copy, subject lines, channels, and delivery statuses.
- **`admin_users` & `admin_sessions` (`admin.ts`):** Manages shared pilot access authentication.

### Migration Rules
- Committed migrations live in `netlify/database/migrations/`.
- **Never edit an existing applied migration.**
- Generate new migrations using: `npm run db:generate`.
- Apply migrations using: `npm run db:migrate`.

---

## 6. Authentication & Security Model

The system implements a shared pilot authentication architecture (`src/auth/`):
- **Local Development:** Loopback requests (`127.0.0.1` and `localhost`) automatically bypass authentication for rapid iteration.
- **Remote / Hosted Access:** Requires shared pilot credentials (`APP_SHARED_PASSWORD`).
- **Security Protections:**
  - Password hashing with PBKDF2 / Argon2.
  - Secure, HttpOnly, SameSite `__Host` cookies.
  - Explicit CSRF token validation on mutating POST/PUT/DELETE requests via `authenticatedFetch`.
  - Strict input sanitization and domain verification on all web searches.

---

## 7. Environment Variables Configuration

Create a `.env.local` file in the workspace root with the following keys:

```bash
# Database (PostgreSQL / Neon)
DATABASE_URL=postgresql://user:password@ep-host.region.neon.tech/neondb?sslmode=require

# LLM Provider (Groq)
GROQ_API_KEY=gsk_...

# Web Research Search Provider (Exa)
EXA_API_KEY=...
# Optional: Set to 'fake' for offline testing without consuming Exa credits
# SEARCH_PROVIDER=fake

# Authentication & Session Security
APP_SESSION_SECRET=a_very_long_random_secret_string_minimum_32_characters
APP_SHARED_PASSWORD=your_shared_team_password

# Application Origin (for CSRF validation in production)
APP_ORIGIN=http://127.0.0.1:3000
```

---

## 8. Runbook & Developer Operations

### Starting the Development Server
```bash
npm run dev
# Server boots at http://127.0.0.1:3000
```

### Running Static Typecheck
```bash
npm run typecheck
# Runs tsc --noEmit (must pass with 0 errors)
```

### Running the Test Suite
```bash
npm test
# Executes all 86 unit and integration tests via tsx
```

### Git & Branch Workflow
- Work is conducted on feature branches (e.g., `dev_mal`).
- Pushes require Windows Credential Manager:
  ```bash
  git -c credential.helper=manager push origin dev_mal
  ```

---

## 9. Critical Conventions & Guardrails

1. **Copywriting Tone Rule:** Never use em-dashes (`—`) or en-dashes (`–`) in outreach copy or message templates. Use hyphens, commas, or direct sentences instead.
2. **PostgreSQL Persistence Rule:** Never store data exclusively in JSON or frontend state if it belongs in the database. Ensure schema updates accompany new fields.
3. **No Unbounded Research:** Background research jobs must always have bounded limits (`maxProspects`, bounded search query limits) to prevent runaway API spend.
4. **Link Formatting in Tools:** When generating reports or referencing files, always use clickable markdown links with `file:///` and forward slashes.

---

## 10. Contact & Repository Information

- **GitHub Repository:** [https://github.com/Lunim-Corporate/marcom-automation](https://github.com/Lunim-Corporate/marcom-automation)
- **Primary Branch:** `dev_mal`
- **Application Port:** `3000` (Local: `http://127.0.0.1:3000`)
