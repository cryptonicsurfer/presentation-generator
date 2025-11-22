import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import axios from 'axios';

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
 * Search for companies in Directus CRM
 */
export const searchDirectusCompaniesTool = tool(
  'search_directus_companies',
  'Search for companies in the Directus CRM system. Use fuzzy search by company name or exact match by organization number.',
  {
    searchTerm: z.string().describe('Company name or organization number to search for'),
    fields: z.string().optional().describe('Comma-separated fields to return (default: id,name,organization_number,industry,description,employees)'),
  },
  async (args) => {
    try {
      const fields = args.fields || 'id,name,organization_number,industry,description,employees,street_address,city';

      // Try fuzzy search first
      const response = await axios.get(`${DIRECTUS_URL}/items/companies`, {
        headers: getDirectusHeaders(),
        params: {
          search: args.searchTerm,
          fields,
        },
      });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            count: response.data.data.length,
            companies: response.data.data,
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            error: error instanceof Error ? error.message : 'Unknown error',
            hint: 'Check if the company exists in the CRM system or try a different search term.'
          }, null, 2)
        }],
        isError: true
      };
    }
  }
);

/**
 * Analyze meetings with flexible grouping and filtering
 * Replaces the old count_directus_meetings with more powerful capabilities
 */
export const analyzeDirectusMeetingsTool = tool(
  'analyze_meetings',
  `Analyze meetings in Directus CRM with flexible grouping and filtering.

  Can be used for:
  - Count meetings for a specific company
  - Get top N companies by meeting count
  - Analyze meetings by industry
  - List all meetings for a period

  Uses the notes_companies junction table for accurate many-to-many relationship querying.`,
  {
    year: z.number().optional().describe('Year to analyze (default: current year)'),
    companyId: z.number().optional().describe('Filter by specific company ID'),
    groupBy: z.enum(['company', 'industry', 'month', 'all']).optional().describe('How to group results (default: "all")'),
    limit: z.number().optional().describe('Maximum number of results (default: 50, max: 100)'),
    sortBy: z.enum(['count', 'date']).optional().describe('Sort by meeting count or date (default: "count")'),
    includeCompanyDetails: z.boolean().optional().describe('Include full company details (default: false)'),
  },
  async (args) => {
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
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                count: 0,
                year,
                companyId: args.companyId,
                message: 'No meetings found for this company'
              }, null, 2)
            }]
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
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              count: notesResponse.data.meta?.filter_count || 0,
              year,
              companyId: args.companyId,
            }, null, 2)
          }]
        };
      }

      // For broader analysis, fetch all meetings for the year
      const notesResponse = await axios.get(`${DIRECTUS_URL}/items/notes`, {
        headers: getDirectusHeaders(),
        params: {
          'filter[category][_eq]': 'Meeting',
          'filter[date_created][_gte]': `${year}-01-01`,
          'filter[date_created][_lt]': `${year + 1}-01-01`,
          fields: 'id,date_created,name,body',
          limit: 1000,
        },
      });

      const meetings = notesResponse.data.data;

      // Fetch junction data to get company associations
      const junctionResponse = await axios.get(`${DIRECTUS_URL}/items/notes_companies`, {
        headers: getDirectusHeaders(),
        params: {
          'filter[notes_id][_in]': meetings.map((m: any) => m.id).join(','),
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
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                year,
                groupBy,
                results: [],
                message: 'No meetings found for this period'
              }, null, 2)
            }]
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
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                year,
                groupBy: 'company',
                totalMeetings: meetings.length,
                results,
              }, null, 2)
            }]
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
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                year,
                groupBy: 'industry',
                totalMeetings: meetings.length,
                results,
              }, null, 2)
            }]
          };
        }
      }

      // Default: return summary
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            year,
            totalMeetings: meetings.length,
            uniqueCompanies: Object.keys(meetingsByCompany).length,
            message: 'Use groupBy parameter to see detailed breakdown',
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            error: error instanceof Error ? error.message : 'Unknown error',
            hint: 'Check if the parameters are correct and data exists for the requested period.'
          }, null, 2)
        }],
        isError: true
      };
    }
  }
);

/**
 * Get contact persons for a company
 */
export const getDirectusContactsTool = tool(
  'get_directus_contacts',
  'Get contact persons (people) associated with a company in Directus CRM.',
  {
    companyId: z.number().describe('The company ID from Directus'),
    fields: z.string().optional().describe('Comma-separated fields to return (default: id,name,email,phone,title)'),
  },
  async (args) => {
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
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            count: response.data.data.length,
            contacts: response.data.data,
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            error: error instanceof Error ? error.message : 'Unknown error',
            hint: 'Check if the company ID exists in Directus.'
          }, null, 2)
        }],
        isError: true
      };
    }
  }
);

