# Repository Guidelines

## Project Structure & Module Organization
The Next.js App Router lives in `app/`, where `page.tsx` renders the presentation generator UI and `app/api/{generate|tweak}/route.ts` stream SSE responses from Claude. Shared UI sits under `components/` (e.g., `components/presentation-generator.tsx` plus Radix-based inputs in `components/ui/`). All domain logic is in `lib/`: `lib/presentation` handles prompt assembly and HTML templating, `lib/mcp` wraps MCP tools for Postgres and Directus, and `lib/utils.ts` stores helpers. Static assets belong in `public/`, and exploratory scripts (such as tool inspectors) belong in `scripts/` to keep runtime code clean.

## Build, Test, and Development Commands
- `npm run dev` – Launches the Next.js dev server with hot reload on http://localhost:3000.
- `npm run build` – Creates an optimized production bundle; run before deploying agents.
- `npm run start` – Serves the production build locally to validate SSR/edge settings.
- `npm run lint` – Executes ESLint with the Next.js Core Web Vitals config.
- `npx tsx scripts/test-mcp-tools.ts` – Dumps registered MCP tool schemas to verify inputs before shipping.

## Coding Style & Naming Conventions
Use TypeScript everywhere, functional React components, and 2-space indentation (match `components/presentation-generator.tsx`). Components and hooks are PascalCase, local helpers are camelCase, and files exporting React components use `.tsx`. Rely on the `@/` alias for internal imports, colocate CSS in `app/globals.css`, and keep API logic in `app/api/*` to benefit from Next.js route handlers. Run `npm run lint` before sending a PR; prefer fixing violations instead of silencing them.

## Testing Guidelines
There is no Jest harness yet, so lean on targeted scripts. Run `npx tsx scripts/test-mcp-tools.ts` whenever MCP schemas change to ensure every parameter exposes a `description` and optionality flag. Exercise `npm run dev` locally and validate SSE streaming via the UI; for persistence changes, mock Directus/Postgres responses to avoid hitting production data.

## Commit & Pull Request Guidelines
Git history favors short, imperative messages such as `Fix MCP tools and presentation tweak functionality` or `Lägg till presentation tweak-funktionalitet`. Follow that pattern, optionally prefixing the touched area (`app/api`, `lib/mcp`). PRs should include: a concise summary, screenshots or GIFs when modifying the UI, reproduction steps for MCP fixes, and links to any tracked issue or internal ticket. Call out new env vars or schema changes so downstream agents can update their `.env.local` accordingly.

## Security & Configuration Tips
Store all secrets in `.env.local` (e.g., `ANTHROPIC_API_KEY`, `DIRECTUS_URL`, `DIRECTUS_ACCESS_TOKEN`, `DATABASE_URL_FBG_ANALYTICS`). Never log token values; sanitize tool-result logs before attaching them to responses. Local development can reuse staging credentials, but production builds require SSL-enabled Postgres connections as shown in `lib/mcp/postgres-tools.ts`.
