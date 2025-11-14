# Presentation Generator Setup

This is a Next.js web application that uses the Claude Agent SDK to generate data-driven presentations from PostgreSQL databases and Directus CRM.

## Prerequisites

1. Node.js 18+ installed
2. Access to the FBG databases (fbg_analytics, scb_data, food_production_sweden)
3. Access to Directus CMS
4. Anthropic API key

## Environment Setup

1. Copy `.env.local.example` to `.env.local`:
   ```bash
   cp .env.local.example .env.local
   ```

2. Fill in your credentials in `.env.local`:
   - `ANTHROPIC_API_KEY` - Your Anthropic API key
   - `DATABASE_URL_*` - PostgreSQL connection strings
   - `DIRECTUS_URL` - Directus CMS URL
   - `DIRECTUS_ACCESS_TOKEN` - Directus API token

## Installation

```bash
npm install --legacy-peer-deps
```

Note: We use `--legacy-peer-deps` due to a zod version conflict between the Claude Agent SDK and Next.js 16.

## Running the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Usage

1. Enter a prompt describing the presentation you want to generate:
   - "Skapa en företagsrapport för Randek AB"
   - "KPI-översikt för Falkenberg Q4 2024"
   - "Analys av matproduktion i Halland"

2. Click "Generera Presentation"

3. Watch as Claude:
   - Searches the Directus CRM for company information
   - Queries PostgreSQL databases for financial and statistical data
   - Generates HTML slides with data visualizations

4. Preview the presentation in the browser

5. Download as HTML file

## Architecture

- **Frontend**: Next.js 16 + React 19 + shadcn/ui
- **Backend**: Next.js API routes
- **AI**: Claude Agent SDK with custom MCP tools
- **Databases**: PostgreSQL (3 databases) + Directus CMS
- **Styling**: Tailwind CSS v4 with Falkenberg's graphic profile

## MCP Tools

The app uses custom MCP (Model Context Protocol) tools to securely access databases:

### PostgreSQL Tools
- `query_fbg_analytics` - Company financials, job postings, employment stats
- `query_scb_data` - KPI data, economic indicators
- `query_food_production` - Food production statistics

### Directus CMS Tools
- `search_directus_companies` - Search companies by name or org number
- `count_directus_meetings` - Count meetings held with a company
- `get_directus_contacts` - Get contact persons
- `get_directus_tasks` - Get open tasks

## Skills

The system uses skills from the original Claude Code setup:
- `/Users/paulklinteby/presentation-generator/.claude/skills/fbg-postgres/SKILL.md`
- `/Users/paulklinteby/presentation-generator/.claude/skills/directus-cms/SKILL.md`

These are loaded as system prompts to guide Claude's behavior.

## Generated Presentations

Generated presentations are standalone HTML files that include:
- Tailwind CSS (via CDN)
- Lucide icons (via CDN)
- Falkenberg's color palette and fonts
- Keyboard navigation (arrow keys, space)
- Print-to-PDF support

## Troubleshooting

### Port already in use
If port 3000 is already in use, you can specify a different port:
```bash
PORT=3001 npm run dev
```

### Database connection errors
- Verify your connection strings in `.env.local`
- Check that your IP is whitelisted on the database server
- Ensure SSL settings are correct

### Directus API errors
- Verify your access token is valid
- Check that the token has permissions to read companies, notes, people, and tasks

## Development

### Adding new MCP tools
Add new tools in `lib/mcp/` directory and export them from `lib/mcp/index.ts`.

### Modifying presentation templates
Edit `lib/presentation/template.ts` to change the HTML structure and styling.

### Updating skills
The skills are loaded from the external project directory. Any changes to the original skills will be reflected here.
