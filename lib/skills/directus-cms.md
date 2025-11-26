---
description: Query Directus CMS for company information, meeting notes, people, and tasks to enrich company reports and presentations
allowed-tools: Read(.env), Bash(curl:*)
---

# Directus CMS Access Skill

This skill provides access to Business Falkenberg's Directus CMS for querying CRM data including companies, people, notes (meetings), and tasks.

## Overview

Use this skill to:
1. **Find company information** from the CRM system
2. **Count meetings** held with specific companies
3. **Get contact persons** (people) associated with companies
4. **Track tasks** related to companies
5. **Enrich company reports** with CRM data alongside financial data from fbg-postgres

## Available Collections

### 1. companies
**Purpose:** Company CRM records with contact info and metadata

**Key Fields:**
- `id` - Primary key (integer)
- `name` - Company name (string)
- `organization_number` - Org nummer (string)
- `domain_name` - Website domain (string)
- `industry` - Industry/sector (string)
- `description` - Company description (text)
- `employees` - Number of employees (integer)
- `street_address`, `zip_code`, `city` - Address fields
- `account_owner` - User responsible for account (UUID, FK to directus_users)
- `date_created`, `date_updated` - Timestamps

### 2. notes
**Purpose:** Meeting notes, phone calls, emails, and general notes

**Key Fields:**
- `id` - Primary key (integer)
- `name` - Note title/subject (string)
- `body` - Note content (rich text/markdown)
- `category` - Type of note (string): **"Meeting"**, "Call", "Email", "Note"
- `companies` - Related companies (array of company IDs)
- `people` - Related people (array of person IDs)
- `tasks` - Related tasks (array of task IDs)
- `attachments` - File attachments (array)
- `date_created`, `date_updated` - Timestamps
- `user_created`, `user_updated` - User tracking

**Important:** Filter by `category = "Meeting"` to count actual meetings.

### 3. people
**Purpose:** Contact persons at companies

**Key Fields:**
- `id` - Primary key (integer)
- `company` - Related company ID (integer, FK to companies)
- `name` - Person's name (string)
- `email` - Email address (string)
- `phone` - Phone number (string)
- `title` - Job title/position (string)
- `date_created`, `date_updated` - Timestamps

### 4. tasks
**Purpose:** Tasks and follow-ups related to companies/people

**Key Fields:**
- `id` - Primary key (integer)
- `status` - Task status (string): "To do", "In progress", "Done", "Cancelled"
- `title` - Task title (string)
- `description` - Task details (text)
- `company` - Related company (integer)
- `assignee` - Assigned user (UUID)
- `due_date` - Due date (date)
- `date_created`, `date_updated` - Timestamps

## Important: Bash Tool Compatibility

**CRITICAL for Claude Code users:**

When using curl with Directus API in Bash tool:

1. ✅ **Use single-line commands** - NO line breaks with `\`
2. ✅ **URL-encode brackets** - Use `%5B` for `[` and `%5D` for `]`
3. ✅ **Single quotes for URLs** - Prevents shell expansion
4. ✅ **Filter many-to-many with Python** - Don't rely on Directus `_contains` for array fields

**Example of WRONG syntax (will fail in Bash tool):**
```bash
# ❌ Line breaks cause parse errors
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://cms.businessfalkenberg.se/items/notes?filter[category][_eq]=Meeting"
```

**Example of CORRECT syntax:**
```bash
# ✅ Single line, URL-encoded brackets
curl -s -H 'Authorization: Bearer TOKEN' 'https://cms.businessfalkenberg.se/items/notes?filter%5Bcategory%5D%5B_eq%5D=Meeting'
```

## How to Use This Skill

### Step 1: Read Directus Credentials
Always start by reading the `.env` file to get API credentials:

```bash
# Read from .env file
DIRECTUS_URL=https://cms.businessfalkenberg.se
DIRECTUS_ACCESS_TOKEN=<token>
```

Available variables in `.env`:
- `DIRECTUS_URL` - Base URL for Directus API
- `DIRECTUS_ACCESS_TOKEN` - Static access token for authentication

### Step 2: Query Directus API

All API requests require the Authorization header:
```bash
curl -H "Authorization: Bearer $DIRECTUS_ACCESS_TOKEN" \
     "https://cms.businessfalkenberg.se/items/{collection}"
```

## Common Query Patterns

### Find Company by Search (Fuzzy Match) ⭐ RECOMMENDED

**Use the `search` parameter for the best fuzzy matching experience:**

```bash
# Search for company (matches name, org.nummer, industry, etc.)
curl -s -H 'Authorization: Bearer TOKEN' 'https://cms.businessfalkenberg.se/items/companies?search=Randek&fields=id,name,organization_number,employees,revenue'
```

**What `search` does:**
- ✅ Fuzzy/partial matching across multiple fields
- ✅ Searches in: `name`, `organization_number`, `industry`, `domain_name`, `description`
- ✅ Case-insensitive
- ✅ Finds "Randek AB" when you search "randek"
- ✅ Finds "SIA Glass AB" when you search "sia glass"
- ✅ Even works with org.nummer: search "556399-7146" finds the company

**Example - Search for "Gekås":**
```bash
curl -s -H 'Authorization: Bearer TOKEN' 'https://cms.businessfalkenberg.se/items/companies?search=Gekås&fields=id,name,organization_number'
```

Returns companies matching "Gekås" in any searchable field.

**When to use `search` vs `filter`:**
- 🎯 **Use `search`**: When user provides company name (fuzzy matching needed)
- 🔍 **Use `filter`**: When you have exact org.nummer or want specific field matching

### Find Company by Filter (Exact/Specific Match)

If you need more control or exact matching:

```bash
# By name (partial match with _contains)
curl -s -H 'Authorization: Bearer TOKEN' 'https://cms.businessfalkenberg.se/items/companies?filter%5Bname%5D%5B_contains%5D=Randek&fields=*'

# By organization number (exact match)
curl -s -H 'Authorization: Bearer TOKEN' 'https://cms.businessfalkenberg.se/items/companies?filter%5Borganization_number%5D%5B_eq%5D=5563997146&fields=*'
```

### Count Meetings for a Company (Current Year)

This is the **most important query** for company reports.

**CRITICAL:** Notes and Companies have a **many-to-many** relation via the junction table `notes_companies`. You MUST query this table, not the `notes.companies` array!

**The correct approach (2-step process):**

**Step 1: Get note IDs from junction table**
```bash
COMPANY_ID=278
curl -s -H 'Authorization: Bearer <TOKEN>' "https://cms.businessfalkenberg.se/items/notes_companies?filter%5Bcompanies_id%5D%5B_eq%5D=$COMPANY_ID&fields=notes_id&limit=500"
```

This returns: `{"data":[{"notes_id":104},{"notes_id":237}]}`

**Step 2: Count meetings from those note IDs**
```bash
NOTE_IDS="104,237"  # From step 1
curl -s -H 'Authorization: Bearer <TOKEN>' "https://cms.businessfalkenberg.se/items/notes?filter%5Bid%5D%5B_in%5D=$NOTE_IDS&filter%5Bcategory%5D%5B_eq%5D=Meeting&filter%5Bdate_created%5D%5B_gte%5D=2025-01-01&meta=filter_count"
```

Returns: `{"meta":{"filter_count":2},"data":[...]}`

**Complete workflow in Python:**

```bash
python3 << 'SCRIPT'
import json, subprocess

TOKEN = "<your_token>"
BASE_URL = "https://cms.businessfalkenberg.se"
COMPANY_ID = 278
YEAR = "2025"

# Step 1: Get note IDs from junction table
cmd1 = f"curl -s -H 'Authorization: Bearer {TOKEN}' '{BASE_URL}/items/notes_companies?filter%5Bcompanies_id%5D%5B_eq%5D={COMPANY_ID}&fields=notes_id&limit=500'"
result1 = subprocess.run(cmd1, shell=True, capture_output=True, text=True)
data1 = json.loads(result1.stdout)
note_ids = [item['notes_id'] for item in data1.get('data', [])]

if not note_ids:
    print(0)
else:
    # Step 2: Count meetings from those notes
    note_ids_str = ','.join(map(str, note_ids))
    cmd2 = f"curl -s -H 'Authorization: Bearer {TOKEN}' '{BASE_URL}/items/notes?filter%5Bid%5D%5B_in%5D={note_ids_str}&filter%5Bcategory%5D%5B_eq%5D=Meeting&filter%5Bdate_created%5D%5B_gte%5D={YEAR}-01-01&meta=filter_count'"
    result2 = subprocess.run(cmd2, shell=True, capture_output=True, text=True)
    data2 = json.loads(result2.stdout)
    count = data2.get('meta', {}).get('filter_count', 0)
    print(count)
SCRIPT
```

**Key points:**
- ✅ Use `notes_companies` junction table (NOT `notes.companies` array!)
- ✅ Two-step process: get note_ids → filter those notes
- ✅ Filter on `category=Meeting` and `date_created >= YEAR-01-01`
- ✅ Use `meta=filter_count` to get total count
- ⚠️ Cannot filter on nested fields in junction table (Directus limitation)

### Get All Notes for a Company

```bash
# All notes (meetings, calls, emails, general notes)
curl -s -H "Authorization: Bearer $DIRECTUS_ACCESS_TOKEN" \
  "https://cms.businessfalkenberg.se/items/notes?filter[companies][_contains]=21&fields=id,name,category,date_created&sort=-date_created"
```

### Get Contact Persons for a Company

```bash
# Get all people at a company
curl -s -H "Authorization: Bearer $DIRECTUS_ACCESS_TOKEN" \
  "https://cms.businessfalkenberg.se/items/people?filter[company][_eq]=21&fields=id,name,email,phone,title"
```

### Get Tasks Related to a Company

```bash
# Get open tasks for a company
curl -s -H "Authorization: Bearer $DIRECTUS_ACCESS_TOKEN" \
  "https://cms.businessfalkenberg.se/items/tasks?filter[company][_eq]=21&filter[status][_neq]=Done&filter[status][_neq]=Cancelled&fields=id,title,status,due_date"
```

## API Query Syntax

### Filtering
Directus uses a rich filtering syntax in query parameters:

**Comparison operators:**
- `_eq` - Equal to
- `_neq` - Not equal to
- `_contains` - Contains (for strings and arrays)
- `_ncontains` - Does not contain
- `_gt` - Greater than
- `_gte` - Greater than or equal to
- `_lt` - Less than
- `_lte` - Less than or equal to
- `_null` - Is NULL
- `_nnull` - Is not NULL

**Examples:**
```bash
# Company name contains "Randek"
filter[name][_contains]=Randek

# Notes created after 2025-01-01
filter[date_created][_gte]=2025-01-01

# Notes with category = "Meeting"
filter[category][_eq]=Meeting

# Tasks that are NOT Done or Cancelled
filter[status][_neq]=Done
```

### Field Selection
Use `fields` parameter to select specific fields:

```bash
# Select specific fields
fields=id,name,organization_number,employees

# Select all fields
fields=*

# Select nested relations (if needed)
fields=*,people.*
```

### Sorting
Use `sort` parameter:

```bash
# Sort by date_created descending (newest first)
sort=-date_created

# Sort by name ascending
sort=name

# Multiple sorts
sort=-date_created,name
```

### Limiting and Pagination
```bash
# Limit to 10 results
limit=10

# Skip first 20 results (pagination)
offset=20

# Combine for page 3 (page size 10)
limit=10&offset=20
```

### Aggregation and Metadata
```bash
# Include total count in response
meta=total_count

# Include filtered count (useful with filters)
meta=filter_count

# Include both
meta=total_count,filter_count
```

## Best Practices

### 1. Always Handle JSON Response
Parse JSON using `python3 -m json.tool` or `jq`:

```bash
curl -s ... | python3 -m json.tool
```

### 2. Check for Empty Results
```bash
RESULT=$(curl -s ...)
if echo "$RESULT" | grep -q '"data":\[\]'; then
  echo "No results found"
fi
```

### 3. Extract Specific Values
```bash
# Get just the count
COUNT=$(curl -s ... | grep -o '"filter_count":[0-9]*' | grep -o '[0-9]*')
```

### 4. Combine with fbg-postgres Data
When building company reports, use BOTH skills:
1. Get financial data from fbg-postgres (omsättning, anställda, soliditet, etc.)
2. Get CRM data from directus-cms (meetings, contacts, tasks)
3. Combine in presentation

## Company Report Workflow

**Use Case:** Create a company report for "Företagsbesök FöretagsSafari"

### Step 1: Search for Company in Directus (PRIMARY!)

**Use the `search` parameter for best results:**

```bash
# Search by company name (fuzzy matching)
curl -s -H 'Authorization: Bearer TOKEN' 'https://cms.businessfalkenberg.se/items/companies?search=Randek&fields=id,name,organization_number,description,industry'
```

**This gives you:**
- `company_id` (for later CRM queries)
- `organization_number` (for PostgreSQL query)
- `description`, `industry` (for presentation overview)

**Result example:**
```json
{
  "data": [{
    "id": 42,
    "name": "Randek AB",
    "organization_number": "5563997146",
    "description": "...",
    "industry": "Tillverkning"
  }]
}
```

**If multiple results:** Ask user which company they mean
**If no results:** Fallback to PostgreSQL fuzzy search + WebSearch

### Step 2: Get Financial Data
Use **fbg-postgres skill**:
```bash
psql "$DATABASE_URL" -c "
  SELECT omsattning, anstallda, soliditet, resultat, rorelsemarginal
  FROM company_financials
  WHERE org_nummer = '5563997146'
  ORDER BY bokslutsaar DESC LIMIT 1
"
```

### Step 3: Get Web Information
Use **WebSearch**:
```bash
Search for company website, products, news
```

### Step 4: Count Meetings This Year
Use **directus-cms skill** with the junction table approach:

```bash
# Step 1: Get note IDs from notes_companies junction table
COMPANY_ID=42
NOTE_IDS=$(curl -s -H 'Authorization: Bearer <TOKEN>' "https://cms.businessfalkenberg.se/items/notes_companies?filter%5Bcompanies_id%5D%5B_eq%5D=$COMPANY_ID&fields=notes_id&limit=500" | python3 -c "
import sys, json
data = json.load(sys.stdin)
ids = [str(item['notes_id']) for item in data.get('data', [])]
print(','.join(ids))
")

# Step 2: Count meetings from those note IDs
if [ ! -z "$NOTE_IDS" ]; then
  curl -s -H 'Authorization: Bearer <TOKEN>' "https://cms.businessfalkenberg.se/items/notes?filter%5Bid%5D%5B_in%5D=$NOTE_IDS&filter%5Bcategory%5D%5B_eq%5D=Meeting&filter%5Bdate_created%5D%5B_gte%5D=2025-01-01&meta=filter_count" | python3 -c "
import sys, json
data = json.load(sys.stdin)
print(data.get('meta', {}).get('filter_count', 0))
"
else
  echo 0
fi
```

### Step 5: Get Contact Persons
```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://cms.businessfalkenberg.se/items/people?filter[company][_eq]=42&fields=name,title,email"
```

### Step 6: Create Presentation
Combine all data into presentation sections showing:
- Company overview (web + CRM description)
- Financial performance (fbg-postgres)
- **Relationship history: "X meetings held in 2025"** (directus-cms)
- Key contacts (directus-cms)
- Open tasks/follow-ups (directus-cms)

## Output Format

When returning data to the user, always:
1. Explain what collection(s) were queried
2. Show key results (company name, meeting count, etc.)
3. Format dates properly (e.g., "2025-05-16" → "16 maj 2025")
4. Include context (e.g., "3 meetings this year vs 5 last year")
5. Return data ready for presentation generation

## Error Handling

If a query fails:
1. Check the Authorization header is correct
2. Verify the collection name is valid
3. Check filter syntax (use `_eq`, `_contains`, etc.)
4. Ensure field names exist in the collection
5. Check the access token hasn't expired

## Security Notes

- ✅ Credentials are read from `.env` (never hardcode)
- ✅ `.env` is gitignored
- ✅ Use static access tokens (not user passwords)
- ⚠️ Don't expose raw access tokens in output
- ⚠️ Be careful with personal data (GDPR compliance)

## Quick Reference

**Get company by name:**
```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "$DIRECTUS_URL/items/companies?filter[name][_contains]=<name>&fields=*"
```

**Count meetings this year:**
```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "$DIRECTUS_URL/items/notes?filter[companies][_contains]=<id>&filter[category][_eq]=Meeting&filter[date_created][_gte]=$(date +%Y)-01-01&meta=filter_count"
```

**Get contacts:**
```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "$DIRECTUS_URL/items/people?filter[company][_eq]=<id>&fields=name,email,title"
```

**Get open tasks:**
```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "$DIRECTUS_URL/items/tasks?filter[company][_eq]=<id>&filter[status][_in]=To do,In progress&fields=title,due_date"
```

## Integration with Other Skills

### With fbg-postgres
Combine CRM data with financial data:
```
1. directus-cms: Find company → get company_id and org_number
2. fbg-postgres: Query company_financials by org_nummer
3. directus-cms: Count meetings for company_id
4. Combine: Present financial performance + relationship strength
```

### With create-presentation
Use both skills in a company report:
```
1. Use directus-cms to find company and count interactions
2. Use fbg-postgres for financial data
3. Use WebSearch for current news
4. Generate presentation with all data combined
```

## Example: Complete Company Report Query

```bash
#!/bin/bash
# Find company and get all relevant data

# 1. Load credentials
source .env

# 2. Find company
COMPANY_DATA=$(curl -s -H "Authorization: Bearer $DIRECTUS_ACCESS_TOKEN" \
  "$DIRECTUS_URL/items/companies?filter[name][_contains]=Randek&fields=id,name,organization_number,employees,industry,description")

COMPANY_ID=$(echo "$COMPANY_DATA" | python3 -c "import sys, json; print(json.load(sys.stdin)['data'][0]['id'])")
ORG_NUM=$(echo "$COMPANY_DATA" | python3 -c "import sys, json; print(json.load(sys.stdin)['data'][0]['organization_number'])")

# 3. Count meetings this year
MEETING_COUNT=$(curl -s -H 'Authorization: Bearer '"$DIRECTUS_ACCESS_TOKEN"'' "$DIRECTUS_URL/items/notes?filter%5Bcategory%5D%5B_eq%5D=Meeting&filter%5Bdate_created%5D%5B_gte%5D=2025-01-01&fields=companies&limit=500" | python3 -c "
import sys, json
data = json.load(sys.stdin)
count = sum(1 for n in data.get('data', []) if $COMPANY_ID in n.get('companies', []))
print(count)
")

# 4. Get contacts
CONTACTS=$(curl -s -H 'Authorization: Bearer '"$DIRECTUS_ACCESS_TOKEN"'' "$DIRECTUS_URL/items/people?filter%5Bcompany%5D%5B_eq%5D=$COMPANY_ID&fields=name,title,email")

# 5. Output
echo "Company: $(echo "$COMPANY_DATA" | python3 -c "import sys, json; print(json.load(sys.stdin)['data'][0]['name'])")"
echo "Org Number: $ORG_NUM"
echo "Meetings in $CURRENT_YEAR: $MEETING_COUNT"
echo "Contacts: $CONTACTS"

# 6. Query financial data from fbg-postgres
psql "$DATABASE_URL" -c "SELECT * FROM company_financials WHERE org_nummer = '$ORG_NUM' ORDER BY bokslutsaar DESC LIMIT 1"
```

This skill is designed to work seamlessly with fbg-postgres and create-presentation skills for comprehensive company reports.
