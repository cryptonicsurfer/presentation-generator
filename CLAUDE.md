# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Next.js 16 presentation generator application using React 19, TypeScript, and Tailwind CSS v4. The project is intended to evolve into a web-based presentation workflow that uses the Claude Agent SDK to programmatically orchestrate Claude for generating presentations from database sources.

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
- **AI**: Claude Agent SDK with custom MCP tools
- **Databases**: PostgreSQL (3 databases) + Directus CRM

### Key Components

#### MCP Tools (`lib/mcp/`)
Secure server-side tools for database access:
- `query_fbg_analytics` - Company financials, employment stats
- `query_scb_data` - KPI data, economic indicators
- `query_food_production` - Food production statistics
- `search_directus_companies` - Company search in CRM
- `count_directus_meetings` - Meeting count with proper junction table handling
- `get_directus_contacts` - Contact person retrieval
- `get_directus_tasks` - Open task retrieval

#### Presentation Template System (`lib/presentation/`)
- HTML generation with Falkenberg's graphic profile
- Tailwind CSS v4 with custom color palette
- Lucide icons integration
- Print-to-PDF support
- Skills loaded from existing Claude Code setup

#### API Endpoint (`/api/generate`)
- Accepts user prompts
- Streams real-time progress updates
- Generates complete HTML presentations
- Returns downloadable files

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
