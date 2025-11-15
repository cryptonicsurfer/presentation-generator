import { Pool } from 'pg';
import axios from 'axios';
import { Type, FunctionDeclaration } from '@google/genai';

/**
 * Gemini Tool Definitions
 * Converts our MCP tools to Gemini's FunctionDeclaration format
 */

// PostgreSQL connection pool
let fbgAnalyticsPool: Pool | null = null;

function getFbgAnalyticsPool(): Pool {
  if (!fbgAnalyticsPool) {
    fbgAnalyticsPool = new Pool({
      connectionString: process.env.DATABASE_URL_FBG_ANALYTICS,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
    });
  }
  return fbgAnalyticsPool;
}

// Directus configuration
const DIRECTUS_URL = process.env.DIRECTUS_URL || 'https://cms.businessfalkenberg.se';
const DIRECTUS_TOKEN = process.env.DIRECTUS_ACCESS_TOKEN;

function getDirectusHeaders() {
  if (!DIRECTUS_TOKEN) {
    throw new Error('DIRECTUS_ACCESS_TOKEN not configured');
  }
  return {
    Authorization: `Bearer ${DIRECTUS_TOKEN}`,
  };
}

/**
 * Gemini FunctionDeclarations for our database tools
 */
export const geminiTools: FunctionDeclaration[] = [
  {
    name: 'query_fbg_analytics',
    description: `Query the FBG Analytics PostgreSQL database for company financial data.

PRIMARY TABLE: company_financials - Financial data for companies in Falkenberg
Key columns:
- org_nummer: Organization number (use for matching with Directus)
- foretag: Company name
- bokslutsaar: Fiscal year
- omsattning: Revenue in tkr (thousands SEK)
- anstallda: Number of employees in Falkenberg
- arbetstallen: Number of work locations in Falkenberg
- resultat: Profit/Loss in tkr
- soliditet: Equity ratio (%)
- rorelsemarginal: Operating margin (%)
- bransch_grov: Industry (broad category)
- bransch_fin: Industry (detailed category)

TABLE: job_postings - Job advertisements data
Key columns:
- headline: Job title/description
- employer_name: Company name
- occupation_label: Occupation/role label
- publication_date: When job was published (DATE)
- education_level: Required education
- employer_type: Type of employer

IMPORTANT: All data is scoped to Falkenberg operations only, NOT national/global data.

Example queries:
- Get company financials: "SELECT foretag, org_nummer, bokslutsaar, omsattning, anstallda, arbetstallen, resultat, soliditet FROM company_financials WHERE org_nummer = '5563997146' ORDER BY bokslutsaar DESC LIMIT 1"
- Search by name: "SELECT DISTINCT foretag, org_nummer, omsattning, anstallda FROM company_financials WHERE foretag ILIKE '%Randek%' ORDER BY bokslutsaar DESC LIMIT 5"
- Multi-year trend: "SELECT bokslutsaar, omsattning, anstallda, resultat FROM company_financials WHERE org_nummer = '5563997146' ORDER BY bokslutsaar DESC LIMIT 3"
- Job postings by year: "SELECT EXTRACT(YEAR FROM publication_date) as year, COUNT(*) as total FROM job_postings WHERE employer_name ILIKE '%Randek%' GROUP BY year ORDER BY year DESC"
- Top job titles: "SELECT headline, occupation_label, COUNT(*) as count FROM job_postings WHERE employer_name ILIKE '%Randek%' GROUP BY headline, occupation_label ORDER BY count DESC LIMIT 10"

Other tables: education_cohort_data, scb_employment_stats

ALWAYS use LIMIT to avoid overwhelming results.`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'SQL SELECT query to execute. Must include LIMIT clause.',
        },
        params: {
          type: Type.ARRAY,
          description: 'Query parameters for parameterized queries (optional)',
          items: {
            type: Type.STRING,
          },
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_directus_companies',
    description: `Search for companies in the Directus CRM system. Use fuzzy search by company name or exact match by organization number.

Returns:
- id: Company ID (needed for other Directus tools)
- name: Company name
- organization_number: Organization number (use to query PostgreSQL financials)
- industry: Industry/sector
- description: Company description
- employees: Number of employees (may differ from PostgreSQL data)
- street_address, city: Location info

Example: Search for "Randek" to get company ID and org number, then use org number to query financial data from PostgreSQL.`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        searchTerm: {
          type: Type.STRING,
          description: 'Company name (fuzzy search) or exact organization number',
        },
        fields: {
          type: Type.STRING,
          description: 'Comma-separated fields to return (default: id,name,organization_number,industry,description,employees,street_address,city)',
        },
      },
      required: ['searchTerm'],
    },
  },
  {
    name: 'count_directus_meetings',
    description: `Count the number of meetings held with a specific company in a given year.

IMPORTANT: In Directus, meetings are stored as "notes" with category="Meeting".
The notes_companies junction table links notes to companies.

Returns:
- count: Number of meetings
- year: The year queried
- companyId: The company ID used

Use this after searching for a company to show Business Falkenberg's engagement level.`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        companyId: {
          type: Type.NUMBER,
          description: 'The company ID from Directus (from search_directus_companies result)',
        },
        year: {
          type: Type.NUMBER,
          description: 'Year to count meetings for (default: current year 2025)',
        },
      },
      required: ['companyId'],
    },
  },
  {
    name: 'get_directus_contacts',
    description: `Get contact persons (people) associated with a company in Directus CRM.

Returns list of contacts with:
- id: Contact person ID
- name: Full name
- email: Email address
- phone: Phone number
- title: Job title/role

Use this to show key contacts when creating company presentations.`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        companyId: {
          type: Type.NUMBER,
          description: 'The company ID from Directus (from search_directus_companies result)',
        },
        fields: {
          type: Type.STRING,
          description: 'Comma-separated fields to return (default: id,name,email,phone,title)',
        },
      },
      required: ['companyId'],
    },
  },
];

/**
 * Execute a Gemini tool call
 */
export async function executeGeminiTool(toolName: string, args: any): Promise<any> {
  switch (toolName) {
    case 'query_fbg_analytics':
      return await executeFbgAnalytics(args);

    case 'search_directus_companies':
      return await executeSearchCompanies(args);

    case 'count_directus_meetings':
      return await executeCountMeetings(args);

    case 'get_directus_contacts':
      return await executeGetContacts(args);

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

/**
 * Execute FBG Analytics query
 * Normalizes organization numbers (removes dashes) for PostgreSQL compatibility
 */
async function executeFbgAnalytics(args: { query: string; params?: any[] }): Promise<any> {
  try {
    const pool = getFbgAnalyticsPool();

    // Normalize org_nummer format: remove dashes from organization numbers
    // PostgreSQL stores them without dashes, but Directus returns them with dashes
    let normalizedQuery = args.query;
    const orgNumMatches = args.query.match(/'(\d{6})-(\d{4})'/g);
    if (orgNumMatches) {
      orgNumMatches.forEach(match => {
        const withoutDash = match.replace('-', '');
        normalizedQuery = normalizedQuery.replace(match, withoutDash);
      });
      console.log('[FBG Analytics] Normalized org_nummer in query:', { original: args.query, normalized: normalizedQuery });
    }

    const result = await pool.query(normalizedQuery, args.params);

    return {
      success: true,
      rowCount: result.rowCount,
      rows: result.rows,
      fields: result.fields.map(f => ({ name: f.name, dataType: f.dataTypeID })),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      hint: 'Check your SQL syntax and table/column names. Use LIMIT to avoid large results.',
    };
  }
}

/**
 * Execute Directus company search
 * Auto-normalizes organization numbers: adds dash if missing (5566778899 → 556677-8899)
 */
async function executeSearchCompanies(args: { searchTerm: string; fields?: string }): Promise<any> {
  try {
    const fields = args.fields || 'id,name,organization_number,industry,description,employees,street_address,city';

    // Normalize organization number format for Directus (which stores with dash)
    // If searchTerm is 10 digits without dash, add dash: XXXXXX-XXXX
    let normalizedSearchTerm = args.searchTerm;
    const isOrgNumWithoutDash = /^\d{10}$/.test(args.searchTerm);
    if (isOrgNumWithoutDash) {
      normalizedSearchTerm = args.searchTerm.slice(0, 6) + '-' + args.searchTerm.slice(6);
      console.log('[Directus Search] Normalized org_nummer:', { original: args.searchTerm, normalized: normalizedSearchTerm });
    }

    const response = await axios.get(`${DIRECTUS_URL}/items/companies`, {
      headers: getDirectusHeaders(),
      params: {
        search: normalizedSearchTerm,
        fields,
      },
    });

    return {
      success: true,
      count: response.data.data.length,
      companies: response.data.data,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      hint: 'Check if the company exists in the CRM system or try a different search term.',
    };
  }
}

/**
 * Execute Directus meetings count
 */
async function executeCountMeetings(args: { companyId: number; year?: number }): Promise<any> {
  try {
    const year = args.year || new Date().getFullYear();

    // Step 1: Get note IDs from junction table
    const junctionResponse = await axios.get(`${DIRECTUS_URL}/items/notes_companies`, {
      headers: getDirectusHeaders(),
      params: {
        'filter[companies_id][_eq]': args.companyId,
        fields: 'notes_id',
        limit: 500,
      },
    });

    const noteIds = junctionResponse.data.data.map((item: any) => item.notes_id);

    if (noteIds.length === 0) {
      return {
        success: true,
        count: 0,
        year,
        message: 'No notes found for this company',
      };
    }

    // Step 2: Count meetings from those note IDs
    const notesResponse = await axios.get(`${DIRECTUS_URL}/items/notes`, {
      headers: getDirectusHeaders(),
      params: {
        'filter[id][_in]': noteIds.join(','),
        'filter[category][_eq]': 'Meeting',
        'filter[date_created][_gte]': `${year}-01-01`,
        'meta': 'filter_count',
      },
    });

    const meetingCount = notesResponse.data.meta?.filter_count || 0;

    return {
      success: true,
      count: meetingCount,
      year,
      companyId: args.companyId,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      hint: 'Check if the company ID exists in Directus.',
    };
  }
}

/**
 * Execute Directus contacts retrieval
 */
async function executeGetContacts(args: { companyId: number; fields?: string }): Promise<any> {
  try {
    const fields = args.fields || 'id,name,email,phone,title';

    const response = await axios.get(`${DIRECTUS_URL}/items/people`, {
      headers: getDirectusHeaders(),
      params: {
        'filter[company][_eq]': args.companyId,
        fields,
      },
    });

    return {
      success: true,
      count: response.data.data.length,
      contacts: response.data.data,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      hint: 'Check if the company ID exists in Directus.',
    };
  }
}

/**
 * Cleanup function to close database pools
 */
export async function closeGeminiToolConnections() {
  if (fbgAnalyticsPool) await fbgAnalyticsPool.end();
}
