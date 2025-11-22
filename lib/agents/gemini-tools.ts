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
    name: 'analyze_meetings',
    description: `Analyze meetings in Directus CRM with flexible grouping and filtering.

Can be used for:
- Count meetings for a specific company (use companyId parameter)
- Get top N companies by meeting count (use groupBy='company', limit=10)
- Analyze meetings by industry (use groupBy='industry')
- Get total meeting statistics for a period (use groupBy='all')

IMPORTANT: In Directus, meetings are stored as "notes" with category="Meeting".
The notes_companies junction table links notes to companies.

Examples:
- Meetings for specific company: { companyId: 123, year: 2025 }
- Top 10 companies by meetings: { groupBy: 'company', limit: 10, year: 2025 }
- Meetings by industry: { groupBy: 'industry', year: 2025 }

Returns structured data based on groupBy parameter.`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        year: {
          type: Type.NUMBER,
          description: 'Year to analyze (default: current year 2025)',
        },
        companyId: {
          type: Type.NUMBER,
          description: 'Filter by specific company ID (optional)',
        },
        groupBy: {
          type: Type.STRING,
          description: 'How to group results: "company", "industry", "month", or "all" (default: "all")',
        },
        limit: {
          type: Type.NUMBER,
          description: 'Maximum number of results (default: 50, max: 100)',
        },
        sortBy: {
          type: Type.STRING,
          description: 'Sort by "count" or "date" (default: "count")',
        },
        includeCompanyDetails: {
          type: Type.BOOLEAN,
          description: 'Include full company details like address, employees (default: false)',
        },
      },
      required: [],
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

    case 'analyze_meetings':
      return await executeAnalyzeMeetings(args);

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

    // Hard limit: max 20 rows to avoid overwhelming Gemini API
    const MAX_ROWS = 20;
    const limitedRows = result.rows.slice(0, MAX_ROWS);
    const wasTruncated = (result.rowCount || 0) > MAX_ROWS;

    return {
      success: true,
      rowCount: limitedRows.length,
      totalRowCount: result.rowCount,
      rows: limitedRows,
      fields: result.fields.map(f => ({ name: f.name, dataType: f.dataTypeID })),
      ...(wasTruncated && {
        warning: `Results truncated: showing ${MAX_ROWS} of ${result.rowCount} rows. Use more specific WHERE clauses or LIMIT in query.`
      }),
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
        limit: 10, // Limit to max 10 companies
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
 * Execute Directus meetings analysis
 * Flexible tool that can count, group, and analyze meetings
 */
async function executeAnalyzeMeetings(args: {
  year?: number;
  companyId?: number;
  groupBy?: 'company' | 'industry' | 'month' | 'all';
  limit?: number;
  sortBy?: 'count' | 'date';
  includeCompanyDetails?: boolean;
}): Promise<any> {
  try {
    const year = args.year || new Date().getFullYear();
    const groupBy = args.groupBy || 'all';
    const limit = Math.min(args.limit || 50, 100);
    const sortBy = args.sortBy || 'count';
    const includeDetails = args.includeCompanyDetails || false;

    // If specific company requested, use simpler logic
    if (args.companyId) {
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
          companyId: args.companyId,
          message: 'No meetings found for this company'
        };
      }

      const notesResponse = await axios.get(`${DIRECTUS_URL}/items/notes`, {
        headers: getDirectusHeaders(),
        params: {
          'filter[id][_in]': noteIds.join(','),
          'filter[category][_eq]': 'Meeting',
          'filter[date_created][_gte]': `${year}-01-01`,
          'filter[date_created][_lt]': `${year + 1}-01-01`,
          'meta': 'filter_count',
        },
      });

      return {
        success: true,
        count: notesResponse.data.meta?.filter_count || 0,
        year,
        companyId: args.companyId,
      };
    }

    // For broader analysis, fetch all meetings for the year
    let notesResponse;
    try {
      notesResponse = await axios.get(`${DIRECTUS_URL}/items/notes`, {
        headers: getDirectusHeaders(),
        params: {
          'filter[category][_eq]': 'Meeting',
          'filter[date_created][_gte]': `${year}-01-01`,
          'filter[date_created][_lt]': `${year + 1}-01-01`,
          fields: 'id,date_created,name,body',
          limit: 1000,
        },
      });
    } catch (axiosError: any) {
      console.error('[analyze_meetings] Failed to fetch notes:', axiosError.response?.status, axiosError.response?.data);
      throw new Error(`Failed to fetch meetings: ${axiosError.message}`);
    }

    const meetings = notesResponse.data.data;

    // Fetch junction data to get company associations
    const meetingIds = meetings.map((m: any) => m.id);
    if (meetingIds.length === 0) {
      return {
        success: true,
        year,
        groupBy,
        results: [],
        message: 'No meetings found for this period'
      };
    }

    const junctionResponse = await axios.get(`${DIRECTUS_URL}/items/notes_companies`, {
      headers: getDirectusHeaders(),
      params: {
        'filter[notes_id][_in]': meetingIds.join(','),
        fields: 'notes_id,companies_id',
        limit: 5000,
      },
    });

    const junctions = junctionResponse.data.data;

    // Group meetings by company
    const meetingsByCompany: Record<number, number> = {};
    junctions.forEach((j: any) => {
      meetingsByCompany[j.companies_id] = (meetingsByCompany[j.companies_id] || 0) + 1;
    });

    // If groupBy is 'company' or 'industry', fetch company details
    if (groupBy === 'company' || groupBy === 'industry') {
      const companyIds = Object.keys(meetingsByCompany).map(Number);

      if (companyIds.length === 0) {
        return {
          success: true,
          year,
          groupBy,
          results: [],
          message: 'No meetings found for this period'
        };
      }

      const companiesResponse = await axios.get(`${DIRECTUS_URL}/items/companies`, {
        headers: getDirectusHeaders(),
        params: {
          'filter[id][_in]': companyIds.join(','),
          fields: includeDetails
            ? 'id,name,organization_number,industry,employees,street_address,city'
            : 'id,name,industry',
          limit: 500,
        },
      });

      const companies = companiesResponse.data.data;

      if (groupBy === 'company') {
        // Return top companies by meeting count
        const results = companies
          .map((c: any) => ({
            companyId: c.id,
            companyName: c.name,
            industry: c.industry,
            meetingCount: meetingsByCompany[c.id] || 0,
            ...(includeDetails && {
              organizationNumber: c.organization_number,
              employees: c.employees,
              address: `${c.street_address}, ${c.city}`,
            }),
          }))
          .sort((a: any, b: any) => b.meetingCount - a.meetingCount)
          .slice(0, limit);

        return {
          success: true,
          year,
          groupBy: 'company',
          totalMeetings: meetings.length,
          results,
        };
      } else {
        // Group by industry
        const byIndustry: Record<string, number> = {};
        companies.forEach((c: any) => {
          const industry = c.industry || 'Unknown';
          byIndustry[industry] = (byIndustry[industry] || 0) + (meetingsByCompany[c.id] || 0);
        });

        const results = Object.entries(byIndustry)
          .map(([industry, count]) => ({ industry, meetingCount: count }))
          .sort((a, b) => b.meetingCount - a.meetingCount)
          .slice(0, limit);

        return {
          success: true,
          year,
          groupBy: 'industry',
          totalMeetings: meetings.length,
          results,
        };
      }
    }

    // Default: return summary
    return {
      success: true,
      year,
      totalMeetings: meetings.length,
      uniqueCompanies: Object.keys(meetingsByCompany).length,
      message: 'Use groupBy parameter to see detailed breakdown',
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      hint: 'Check if the parameters are correct and data exists for the requested period.'
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
        limit: 10, // Limit to max 10 contacts
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
