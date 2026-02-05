/**
 * MCP Tools for Year Plan Database (fbg_planning)
 *
 * Provides access to strategic planning data:
 * - Activities (events, meetings, workshops)
 * - Focus areas (Service & Kompetens, Platsutveckling, etc.)
 * - Strategic concepts
 */

import { Pool } from 'pg';

// Connection pool for year plan database
let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL_YEARPLAN;
    if (!connectionString) {
      throw new Error('DATABASE_URL_YEARPLAN environment variable is not set');
    }

    pool = new Pool({
      connectionString,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
    });
  }
  return pool;
}

export type YearPlanQueryParams = {
  year?: number;
  conceptId?: string;
  focusAreaId?: string;
  status?: 'ongoing' | 'decided' | 'completed';
  quarter?: 1 | 2 | 3 | 4;
  half?: 1 | 2;
};

/**
 * Query year plan activities with optional filters
 */
export async function queryYearPlanActivities(params: YearPlanQueryParams = {}) {
  const pool = getPool();

  let whereConditions: string[] = [];
  let queryParams: any[] = [];
  let paramIndex = 1;

  // Year filter
  if (params.year) {
    whereConditions.push(`EXTRACT(YEAR FROM a.start_date) = $${paramIndex}`);
    queryParams.push(params.year);
    paramIndex++;
  }

  // Concept filter
  if (params.conceptId) {
    whereConditions.push(`fa.concept_id = $${paramIndex}`);
    queryParams.push(params.conceptId);
    paramIndex++;
  }

  // Focus area filter
  if (params.focusAreaId) {
    whereConditions.push(`a.focus_area_id = $${paramIndex}`);
    queryParams.push(params.focusAreaId);
    paramIndex++;
  }

  // Status filter
  if (params.status) {
    whereConditions.push(`a.status = $${paramIndex}`);
    queryParams.push(params.status);
    paramIndex++;
  }

  // Quarter filter (Q1=Jan-Mar, Q2=Apr-Jun, Q3=Jul-Sep, Q4=Oct-Dec)
  if (params.quarter) {
    const startMonth = (params.quarter - 1) * 3 + 1;
    const endMonth = params.quarter * 3;
    whereConditions.push(`EXTRACT(MONTH FROM a.start_date) BETWEEN $${paramIndex} AND $${paramIndex + 1}`);
    queryParams.push(startMonth, endMonth);
    paramIndex += 2;
  }

  // Half filter (H1=Jan-Jun, H2=Jul-Dec)
  if (params.half) {
    const startMonth = params.half === 1 ? 1 : 7;
    const endMonth = params.half === 1 ? 6 : 12;
    whereConditions.push(`EXTRACT(MONTH FROM a.start_date) BETWEEN $${paramIndex} AND $${paramIndex + 1}`);
    queryParams.push(startMonth, endMonth);
    paramIndex += 2;
  }

  const whereClause = whereConditions.length > 0
    ? `WHERE ${whereConditions.join(' AND ')}`
    : '';

  const query = `
    SELECT
      a.id,
      a.title,
      a.description,
      a.start_date,
      a.end_date,
      a.responsible,
      a.purpose,
      a.theme,
      a.target_group,
      a.status,
      a.weeks,
      fa.name as focus_area_name,
      fa.color as focus_area_color,
      sc.name as concept_name
    FROM activities a
    JOIN focus_areas fa ON a.focus_area_id = fa.id
    JOIN strategic_concepts sc ON fa.concept_id = sc.id
    ${whereClause}
    ORDER BY a.start_date ASC, fa.sort_order ASC
  `;

  const result = await pool.query(query, queryParams);
  return result.rows;
}

/**
 * Get summary statistics for activities
 */
export async function getYearPlanSummary(params: YearPlanQueryParams = {}) {
  const pool = getPool();

  let whereConditions: string[] = [];
  let queryParams: any[] = [];
  let paramIndex = 1;

  if (params.year) {
    whereConditions.push(`EXTRACT(YEAR FROM a.start_date) = $${paramIndex}`);
    queryParams.push(params.year);
    paramIndex++;
  }

  if (params.conceptId) {
    whereConditions.push(`fa.concept_id = $${paramIndex}`);
    queryParams.push(params.conceptId);
    paramIndex++;
  }

  const whereClause = whereConditions.length > 0
    ? `WHERE ${whereConditions.join(' AND ')}`
    : '';

  // Get counts by status
  const statusQuery = `
    SELECT
      a.status,
      COUNT(*) as count
    FROM activities a
    JOIN focus_areas fa ON a.focus_area_id = fa.id
    ${whereClause}
    GROUP BY a.status
  `;

  // Get counts by focus area
  const focusAreaQuery = `
    SELECT
      fa.name as focus_area,
      fa.color,
      COUNT(*) as count
    FROM activities a
    JOIN focus_areas fa ON a.focus_area_id = fa.id
    ${whereClause}
    GROUP BY fa.name, fa.color, fa.sort_order
    ORDER BY fa.sort_order
  `;

  // Get counts by month
  const monthQuery = `
    SELECT
      EXTRACT(MONTH FROM a.start_date) as month,
      COUNT(*) as count
    FROM activities a
    JOIN focus_areas fa ON a.focus_area_id = fa.id
    ${whereClause}
    GROUP BY EXTRACT(MONTH FROM a.start_date)
    ORDER BY month
  `;

  const [statusResult, focusAreaResult, monthResult] = await Promise.all([
    pool.query(statusQuery, queryParams),
    pool.query(focusAreaQuery, queryParams),
    pool.query(monthQuery, queryParams),
  ]);

  return {
    byStatus: statusResult.rows,
    byFocusArea: focusAreaResult.rows,
    byMonth: monthResult.rows,
  };
}

/**
 * Get all focus areas with their concepts
 */
export async function getFocusAreas() {
  const pool = getPool();

  const query = `
    SELECT
      fa.id,
      fa.name,
      fa.color,
      fa.start_month,
      fa.end_month,
      sc.name as concept_name,
      sc.id as concept_id
    FROM focus_areas fa
    JOIN strategic_concepts sc ON fa.concept_id = sc.id
    ORDER BY sc.sort_order, fa.sort_order
  `;

  const result = await pool.query(query);
  return result.rows;
}

/**
 * MCP Tool definitions for year plan database
 */
export const yearPlanTools = {
  query_year_plan: {
    name: 'query_year_plan',
    description: `Query activities from the year plan database. Returns activities with their focus areas and strategic concepts.

Available filters:
- year: Filter by year (e.g., 2026)
- conceptId: Filter by strategic concept UUID
- focusAreaId: Filter by focus area UUID
- status: Filter by status ('ongoing', 'decided', 'completed')
- quarter: Filter by quarter (1-4)
- half: Filter by half year (1 or 2)

Returns: Array of activities with title, description, dates, responsible, purpose, theme, target_group, status, weeks, focus_area_name, focus_area_color, concept_name`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        year: { type: 'number', description: 'Filter by year (e.g., 2026)' },
        conceptId: { type: 'string', description: 'Filter by strategic concept UUID' },
        focusAreaId: { type: 'string', description: 'Filter by focus area UUID' },
        status: {
          type: 'string',
          enum: ['ongoing', 'decided', 'completed'],
          description: 'Filter by activity status'
        },
        quarter: {
          type: 'number',
          enum: [1, 2, 3, 4],
          description: 'Filter by quarter (Q1-Q4)'
        },
        half: {
          type: 'number',
          enum: [1, 2],
          description: 'Filter by half year (H1 or H2)'
        },
      },
    },
    handler: async (params: YearPlanQueryParams) => {
      const activities = await queryYearPlanActivities(params);
      return JSON.stringify(activities, null, 2);
    },
  },

  get_year_plan_summary: {
    name: 'get_year_plan_summary',
    description: `Get summary statistics for year plan activities. Returns counts grouped by status, focus area, and month.

Available filters:
- year: Filter by year (e.g., 2026)
- conceptId: Filter by strategic concept UUID

Returns: Object with byStatus, byFocusArea, and byMonth arrays`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        year: { type: 'number', description: 'Filter by year (e.g., 2026)' },
        conceptId: { type: 'string', description: 'Filter by strategic concept UUID' },
      },
    },
    handler: async (params: YearPlanQueryParams) => {
      const summary = await getYearPlanSummary(params);
      return JSON.stringify(summary, null, 2);
    },
  },

  get_focus_areas: {
    name: 'get_focus_areas',
    description: 'Get all focus areas with their strategic concepts and colors. Useful for understanding the organizational structure.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
    handler: async () => {
      const focusAreas = await getFocusAreas();
      return JSON.stringify(focusAreas, null, 2);
    },
  },
};
