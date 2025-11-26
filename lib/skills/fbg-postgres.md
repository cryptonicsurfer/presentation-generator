---
description: Query PostgreSQL databases (fbg_analytics, scb_data, food_production) hosted on businessfalkenberg.se for data-driven presentations and analysis
allowed-tools: Read(.env), Bash(psql:*)
---

# FBG PostgreSQL Database Access Skill

This skill provides access to Business Falkenberg's PostgreSQL databases for querying data to use in presentations, reports, and analysis.

## Available Databases

### 1. fbg_analytics (Main Analytics Database)
**Tables:**
- `company_financials` - Company financial data ⭐ **PRIMARY TABLE FOR COMPANY REPORTS**
- `education_cohort_data` - Education cohort tracking
- `education_cohort_stats` - Education statistics
- `education_heatmap_data` - Education heatmap visualization data
- `job_classification_stats` - Job classification statistics
- `job_postings` - Job posting data
- `scb_employment_stats` - SCB employment statistics

**Important about `company_financials`:**
- Data represents company's **operations in Falkenberg only**
- Not national/global data - focus is local economic impact
- One row per org_nummer per year (aggregated if multiple locations)

### 2. scb_data (SCB Statistics)
**Tables:**
- `economic_data` - Economic indicators
- `kpi_data` - KPI measurements
- `kpi_group_members` - KPI group membership
- `kpi_groups` - KPI group definitions
- `kpis` - KPI definitions
- `municipalities` - Municipality reference data

### 3. food_production_sweden
**Tables:**
- `data_sources` - Data source metadata
- `food_production` - Food production data
- `food_production_lan` - Food production by county (län)
- `kommuner` - Municipality reference data

## How to Use This Skill

### Step 1: Read Database Credentials
Always start by reading the `.env` file to get connection details:

```
Read the .env file to get DATABASE_URL or specific database URLs
```

Available connection strings in `.env`:
- `DATABASE_URL` - Default (fbg_analytics)
- `DATABASE_URL_FBG_ANALYTICS`
- `DATABASE_URL_SCB_DATA`
- `DATABASE_URL_FOOD_PRODUCTION`

### Step 2: Explore Table Structure (if needed)
Before querying, you can inspect table structure:

```bash
psql "$DATABASE_URL" -c "\d table_name"
```

Example:
```bash
psql "$DATABASE_URL_SCB_DATA" -c "\d kpi_data"
```

### Step 3: Execute Query
Run SQL queries using psql:

```bash
psql "$DATABASE_URL" -c "SELECT * FROM table_name LIMIT 10"
```

For JSON output (easier to parse):
```bash
psql "$DATABASE_URL" -t -A -F"," -c "SELECT row_to_json(t) FROM (SELECT * FROM table_name LIMIT 10) t"
```

For CSV output:
```bash
psql "$DATABASE_URL" -c "COPY (SELECT * FROM table_name) TO STDOUT WITH CSV HEADER"
```

## Company Financials Table Schema

The `company_financials` table contains financial data for companies operating in Falkenberg.

### Key Columns

**Identification:**
- `id` - Unique ID
- `org_nummer` - Organization number (use this for matching with Directus!)
- `foretag` - Company name
- `bokslutsaar` - Fiscal year

**Company Info:**
- `anstallda` - Number of employees **in Falkenberg**
- `arbetstallen` - Number of work locations in Falkenberg ⭐
- `bransch_grov` - Industry (broad category)
- `bransch_fin` - Industry (detailed category)

**Financial Metrics (all for Falkenberg operations):**
- `omsattning` - Revenue (tkr)
- `resultat` - Profit/Loss (tkr)
- `totalt_kapital` - Total capital (tkr)
- `eget_kapital` - Equity (tkr)
- `soliditet` - Equity ratio (%)
- `rorelsemarginal` - Operating margin (%)
- `lonsamhetsindex` - Profitability index

### Understanding `arbetstallen` (Critical!)

**The `arbetstallen` column indicates how many work locations the company has in Falkenberg.**

**Example - Kappahl Sverige AB:**
```sql
arbetstallen: 1
anstallda: 5
omsattning: 12,885 tkr
```
→ **Interpretation:** "One location with 5 employees and 12.9 Mkr revenue in Falkenberg"

**Example - Gekås Ullared AB:**
```sql
arbetstallen: 3
anstallda: 999
omsattning: 5,093,758 tkr
```
→ **Interpretation:** "3 locations with total 999 employees and 5.1 billion kr revenue in Falkenberg"

**How to present in slides:**

If `arbetstallen = 1`:
```
"5 anställda i Falkenberg"
"12,9 Mkr omsättning"
```

If `arbetstallen > 1`:
```
"999 anställda i Falkenberg (fördelat på 3 arbetsställen)"
"5,1 miljarder kr omsättning"
```

**ALWAYS use this data as-is** - it's already scoped to Falkenberg operations!

## Common Query Patterns

### Get Company Financial Data (for Company Reports)

**Standard query for company presentations:**

```sql
SELECT
  foretag,
  org_nummer,
  bokslutsaar,
  omsattning,
  anstallda,
  arbetstallen,
  resultat,
  soliditet,
  rorelsemarginal,
  bransch_grov,
  bransch_fin
FROM company_financials
WHERE org_nummer = '<org_nummer>'
ORDER BY bokslutsaar DESC
LIMIT 1;
```

**Get multi-year trend:**

```sql
SELECT
  bokslutsaar,
  omsattning,
  anstallda,
  resultat,
  soliditet
FROM company_financials
WHERE org_nummer = '<org_nummer>'
ORDER BY bokslutsaar DESC
LIMIT 3;
```

**Fuzzy search by company name (if org_nummer unknown):**

```sql
SELECT DISTINCT
  foretag,
  org_nummer,
  bokslutsaar,
  omsattning,
  anstallda
FROM company_financials
WHERE foretag ILIKE '%<name>%'
ORDER BY bokslutsaar DESC, omsattning DESC
LIMIT 10;
```

### Get Latest KPI Data
```sql
SELECT k.name, kd.value, kd.year, kd.period, m.name as municipality
FROM kpi_data kd
JOIN kpis k ON kd.kpi_id = k.id
JOIN municipalities m ON kd.municipality_id = m.id
WHERE kd.year = 2024
ORDER BY kd.period DESC
LIMIT 20;
```

### Get Job Posting Statistics
```sql
SELECT
    classification,
    COUNT(*) as total_postings,
    AVG(salary) as avg_salary
FROM job_postings
WHERE posted_date >= '2024-01-01'
GROUP BY classification
ORDER BY total_postings DESC;
```

### Get Food Production by Municipality
```sql
SELECT
    k.kommun_namn,
    fp.product_type,
    fp.production_value,
    fp.year
FROM food_production fp
JOIN kommuner k ON fp.kommun_id = k.kommun_id
WHERE fp.year = 2023
ORDER BY fp.production_value DESC
LIMIT 10;
```

## Best Practices

### 1. Always Use LIMIT for Exploration
When exploring data, always add `LIMIT` to avoid overwhelming output:
```sql
SELECT * FROM large_table LIMIT 10;
```

### 2. Check Row Counts First
Before fetching all data, check how many rows exist:
```sql
SELECT COUNT(*) FROM table_name;
```

### 3. Use Meaningful Column Selection
Don't use `SELECT *` in production queries - specify columns:
```sql
SELECT name, value, year FROM kpi_data WHERE year = 2024;
```

### 4. Handle NULL Values
Be aware of NULL values in data:
```sql
SELECT * FROM table_name WHERE column IS NOT NULL;
```

### 5. Use Appropriate Output Format
- **For presentations**: Use formatted tables or CSV
- **For processing**: Use JSON with `row_to_json()`
- **For debugging**: Use default psql output

## Output Formats

### Table Format (Default)
```bash
psql "$DATABASE_URL" -c "SELECT * FROM kpis LIMIT 5"
```

### CSV Format
```bash
psql "$DATABASE_URL" -c "COPY (SELECT * FROM kpis) TO STDOUT WITH CSV HEADER"
```

### JSON Format
```bash
psql "$DATABASE_URL" -t -c "SELECT json_agg(row_to_json(t)) FROM (SELECT * FROM kpis LIMIT 5) t"
```

## Error Handling

If a query fails:
1. Check the table name is correct (`\dt` to list tables)
2. Verify column names (`\d table_name` for schema)
3. Check for syntax errors in SQL
4. Ensure the connection string is correct

## Security Notes

- ✅ Credentials are read from `.env` (never hardcode)
- ✅ `.env` is gitignored
- ✅ Use read-only queries when possible
- ⚠️ Be cautious with UPDATE/DELETE queries
- ⚠️ Don't expose raw credentials in output

## Example Usage in Presentation Context

When creating a data-driven presentation:

1. **Identify the data need**: "Show top 5 municipalities by employment growth"
2. **Invoke this skill**: Read .env, run query
3. **Return structured data**: JSON or CSV
4. **Use in presentation**: Generate section files with actual numbers

Example workflow:
```bash
# 1. Read credentials
Read .env file

# 2. Query data
psql "$DATABASE_URL_FBG_ANALYTICS" -t -c "
SELECT json_agg(row_to_json(t)) FROM (
  SELECT municipality, employment_rate, year
  FROM scb_employment_stats
  WHERE year = 2024
  ORDER BY employment_rate DESC
  LIMIT 5
) t"

# 3. Use JSON output to populate presentation sections
```

## Quick Reference

**List all databases:**
```bash
psql "$DATABASE_URL" -c "\l"
```

**List tables in current database:**
```bash
psql "$DATABASE_URL" -c "\dt"
```

**Describe table structure:**
```bash
psql "$DATABASE_URL" -c "\d table_name"
```

**Switch database in query:**
```bash
psql "postgresql://user:pass@host:port/other_db" -c "SELECT..."
```

## Return Format

When returning data to the user or for use in presentations, always:
1. Explain what database and table was queried
2. Show a sample of the results
3. Indicate total row count if relevant
4. Suggest how to visualize the data (chart types, layout)
5. Return data in a format ready for presentation generation

## Integration with Other Skills

### With directus-cms
For **complete company reports**, combine financial data from PostgreSQL with CRM data from Directus:

**Workflow:**
1. **fbg-postgres**: Get financial data (omsättning, anställda, soliditet, etc.)
2. **directus-cms**: Get CRM data (meetings, contacts, tasks)
3. Combine both in presentation

**Example - Company Report:**
```bash
# 1. Get financial data (fbg-postgres)
psql "$DATABASE_URL" -c "
  SELECT omsattning, anstallda, soliditet, resultat, rorelsemarginal
  FROM company_financials
  WHERE org_nummer = '5563997146'
  ORDER BY bokslutsaar DESC LIMIT 1
"

# 2. Get CRM data (directus-cms skill)
# - Find company_id by org_nummer
# - Count meetings this year
# - Get contact persons
# - Get open tasks

# 3. Create presentation with combined data
```

**When to use both skills:**
- Creating company reports for "Företagsbesök FöretagsSafari"
- Analyzing business relationships (financial performance + interaction history)
- Preparing for meetings (financial status + past meeting notes)

See the **directus-cms skill** for detailed CRM query examples.
