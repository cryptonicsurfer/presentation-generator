# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Next.js 16 presentation generator application using React 19, TypeScript, and Tailwind CSS v4. It is a working web-based presentation workflow that generates slide decks from database sources. It supports **three interchangeable AI backends** — the Claude Agent SDK, Google Gemini, and Mistral — selected per request by the model ID. Deployed on the VPS at `presgen.businessfalkenberg.se` (Docker, port 3000), behind Directus auth.

## Development Commands

### Running the application
```bash
npm run dev       # Start development server at http://localhost:3000
npm run build     # Build for production
npm start         # Start production server
npm run lint      # Run ESLint
```

### Development workflow
- The development server supports hot module replacement
- Edit `app/page.tsx` to modify the main page - changes auto-refresh
- The app runs on http://localhost:3000 by default

## Architecture & Technology Stack

### Framework & Styling
- **Next.js 16** with App Router (file-based routing in `/app` directory)
- **React 19** with Server Components by default
- **TypeScript** with strict mode enabled
- **Tailwind CSS v4** with PostCSS plugin (`@tailwindcss/postcss`)
- **tw-animate-css** for animations

### UI Component System
The project is configured for **shadcn/ui** components (see `components.json`):
- Style: "new-york" variant
- Base color: neutral
- Icon library: Lucide React
- CSS variables enabled for theming
- Dark mode support via class-based variant

### Path Aliases
Configured in `tsconfig.json`:
- `@/*` - Root directory imports (e.g., `@/components`, `@/lib/utils`)
- `@/components` - Components directory
- `@/lib` - Utility functions and helpers
- `@/hooks` - React hooks
- `@/components/ui` - shadcn/ui components

### Styling System
The project uses Tailwind CSS v4's new configuration approach:
- **No traditional `tailwind.config.js`** - configuration is in `app/globals.css` using `@theme inline`
- CSS variables defined in `:root` and `.dark` for light/dark themes
- OKLCH color space for better color handling
- Custom radius tokens (sm, md, lg, xl)
- Custom dark mode variant: `@custom-variant dark (&:is(.dark *))`

### Font Setup
Uses Next.js font optimization with Geist fonts:
- `Geist` (sans-serif) - Variable font
- `Geist Mono` (monospace) - Variable font
- Fonts are defined in `app/layout.tsx` and exposed via CSS variables

## Project Structure

```
app/
  layout.tsx    # Root layout with fonts and metadata
  page.tsx      # Home page
  globals.css   # Tailwind CSS v4 config and global styles
lib/
  utils.ts      # Utility functions (cn helper for class merging)
public/         # Static assets
components/     # (Not yet created) React components will go here
```

## Key Implementation Details

### Utility Functions
`lib/utils.ts` exports `cn()` which combines `clsx` and `tailwind-merge` for conditional class merging. Use this for all className compositions:
```typescript
cn("base-class", condition && "conditional-class")
```

### Adding shadcn/ui Components
When adding shadcn/ui components, they should be placed in `components/ui/` as configured in `components.json`. The CLI will automatically use the correct paths and aliases.

## Web Application Implementation

The project now includes a fully functional web-based presentation generator:

### Architecture
- **Frontend**: Next.js 16 App Router with React 19 and shadcn/ui
- **Backend**: Next.js API routes with Server-Sent Events (SSE) streaming
- **AI**: three backends, chosen per request by model-ID prefix (`claude-*` / `gemini-*` / `mistral-*`) in `/api/generate`. Default preference order is **Mistral → Gemini → Claude** (Mistral is EU-hosted and reliable while Google's tier has been flaky). Available models per provider come from the `CLAUDE_MODELS` / `GEMINI_MODELS` / `MISTRAL_MODELS` env vars (see `lib/config/models.ts`).
- **Databases**: PostgreSQL + Directus CRM

### Backends & output contract

The three backends differ in *how* they produce the deck:

- **Gemini & Mistral** (`lib/agents/gemini-agent.ts`, `lib/agents/mistral-agent.ts`) are tool-calling loops that share the system prompt from `lib/presentation/gemini-skills-loader.ts`. They return the deck as **plain text in a delimiter format** — `===TITLE===` / `===SLIDE===` / `===END===` — which needs NO escaping. ⚠️ This replaced the old "HTML-as-escaped-JSON-strings" contract, which Mistral couldn't emit reliably (invalid JSON). Do not reintroduce JSON for slide output.
- **Claude** (`@anthropic-ai/claude-agent-sdk`) runs in a workspace and uses the **Write tool to save `presentation.html`** directly (prompt from `lib/presentation/skills-loader.ts`).
- Parsing is unified in `parsePresentationOutput()` in `app/api/generate/route.ts`: delimiter format first, with a legacy-JSON fallback (jsonrepair) for safety. Mistral output is capped at `maxTokens: 16384` so 10–15-slide decks aren't truncated.

### Key Components

#### MCP / agent tools
Secure server-side DB tools, all provider-agnostic executors:
- The **presentation agents** (Gemini/Mistral/Claude) use four: `query_fbg_analytics`, `search_directus_companies`, `analyze_meetings` (replaced the older `count_directus_meetings`), `get_directus_contacts`. Declared for Gemini/Mistral in `lib/agents/gemini-tools.ts`; exposed to Claude via the MCP server in `lib/mcp/`.
- The **year-plan flow** (`/api/generate-yearplan`) adds `query_year_plan`, `get_year_plan_summary`, `get_focus_areas`, `get_group`, and uses `lib/file-parser/` (docx + Mistral OCR) for uploaded attachments.

#### Presentation Template System (`lib/presentation/`)
- HTML generation with Falkenberg's graphic profile (`template.ts`)
- Tailwind CSS v4 with custom color palette, Lucide icons, print-to-PDF
- `slide-parser.ts` extracts/replaces individual `<section>` slides for targeted edits

#### API routes (`app/api/`)
- `generate` — main deck generation (the three-backend SSE endpoint above)
- `generate-yearplan` — Århjul/year-plan deck with file-upload context
- `tweak` / `tweak-slides` — targeted edits to an existing deck
- `export-pdf` — server-side PDF render (Playwright/Chromium)
- `models` — lists available models per provider (⚠️ auth-gated; not a health endpoint)
- `auth` — Directus auth

#### Auth & deployment
- `/api/*` is gated behind Directus auth (`proxy.ts`) → returns 401 unauthenticated. The Docker healthcheck therefore probes `/` (accepts any non-5xx), not `/api/models`.
- Deploy: `ssh glsfbg && cd ~/presentation-generator && git pull && docker compose up -d --build` (drop `--build` for compose-only changes).

#### Frontend UI
- Textarea for prompt input with example prompts
- Real-time status monitoring with color-coded badges
- Preview canvas with embedded iframe
- Download functionality for generated presentations

### Running the Application

```bash
# Development
npm run dev

# Production build
npm run build
npm start
```

Visit http://localhost:3000 to use the presentation generator.

### Security Implementation
- Database credentials stored in `.env.local` (server-side only)
- MCP tools execute queries server-side
- Claude never sees connection strings
- All database access mediated through secure tools

See `IMPLEMENTATION_SUMMARY.md` and `README_SETUP.md` for detailed documentation.
