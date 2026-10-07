# MARCOM Current Architecture

## Overview
MARCOM (Multi-Agent Researcher Communicator) is currently a modern, component-driven frontend application with a premium, cinematic dark-mode visual identity. It is built to serve as a project-independent AI research and communications system.

## Stack & Technologies
- **Frontend Framework**: Next.js 16.3.8 (App Router)
- **UI Library**: React 19.2.8
- **Styling**: Tailwind CSS v4 (configured via modern CSS inline theme variables)
- **Language**: TypeScript (v5)
- **Routing**: Next.js App Router (currently only utilizing the root `/` route for the Home Dashboard)
- **State Management**: React local state (no global state manager like Redux or Zustand is currently present)
- **Data Fetching/API**: Currently mocked out entirely. No active `fetch` or backend API architecture exists.
- **Authentication**: None implemented.
- **Database/Storage**: None implemented (using in-memory mock data).
- **Integrations**: Mock representation of Notion integration. No real integration code.

## Key Directories
- `src/app/`: Contains the Next.js routing structure, root layout (`layout.tsx`), global styles (`globals.css`), and the main page (`page.tsx`).
- `src/components/layout/`: Reusable layout structures (`Sidebar.tsx`, `TopBar.tsx`).
- `src/components/home/`: Specific feature components for the dashboard (`AgentVisual.tsx`, `ProjectsSection.tsx`, `AgentActivitySection.tsx`, etc.).
- `src/components/ui/`: Reusable, atomic UI components (`GlassCard.tsx`, `PrimaryButton.tsx`, `ProgressBar.tsx`, etc.).
- `src/data/`: Contains `mockData.ts` representing the data layer.
- `src/types/`: Contains `index.ts` defining the TypeScript interfaces for the domain models (Project, Agent, Activity, etc.).

## Existing Reusable Components
- **Layout**: `Sidebar`, `TopBar`
- **UI Primitives**: `Avatar`, `GlassCard`, `PrimaryButton`, `SecondaryButton`, `ProgressBar`, `SearchBar`, `SectionHeader`, `StatusBadge`
- **Domain Components**: `ProjectCard` (inside `ProjectsSection`), `AgentNode` (inside `AgentVisual`)

## Design System
The visual identity is defined primarily in `src/app/globals.css` using Tailwind v4's `@theme inline` structure.
- **Background**: Near-black (`#08080c`)
- **Typography**: Inter (sans-serif for UI), Playfair Display (serif for display/headers)
- **Accents**: Semantic colors mapping to system concepts:
  - Blue/Cyan: System/Research
  - Purple: Intelligence/Analysis
  - Pink: Personalization
  - Amber: Human review
  - Green: Completed/Healthy
- **Visuals**: Heavy use of `backdrop-blur`, subtle borders (`white/[0.06]`), and glassmorphism.

## Separation of Concerns (Proposed Extension)
Currently, presentation, data, and "logic" (mocked) are tightly coupled in the frontend. 
As we extend this into a real AI platform, we will follow these boundaries:
- **Presentation Layer**: The existing Next.js React components (extend, do not rewrite).
- **Data Access Layer**: To be built. Should abstract away backend/database calls so UI components don't fetch directly.
- **Agent Logic Layer**: To be built (e.g. backend Python/Node workers or Next.js server actions). Must be strictly decoupled from UI.
- **Configuration & Context**: To be built. Project instructions, Lunim context, and agent prompts must be loaded dynamically, not hardcoded into the UI.

## Technical Constraints & Considerations
- **Do not replace the UI**: The frontend is robust and meets the design spec. We will extend it, not rebuild it.
- **Project Independence**: The current mock data hardcodes specific projects. The real architecture must load projects dynamically and the UI must remain completely agnostic to the project domain.
