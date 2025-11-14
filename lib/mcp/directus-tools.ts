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
 * Count meetings for a company in the current year
 */
export const countDirectusMeetingsTool = tool(
  'count_directus_meetings',
  'Count the number of meetings held with a specific company in a given year. Uses the notes_companies junction table for accurate many-to-many relationship querying.',
  {
    companyId: z.number().describe('The company ID from Directus'),
    year: z.number().optional().describe('Year to count meetings for (default: current year)'),
  },
  async (args) => {
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
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              count: 0,
              year,
              message: 'No notes found for this company'
            }, null, 2)
          }]
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
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            count: meetingCount,
            year,
            companyId: args.companyId,
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

