/**
 * Gemini Tools for Year Plan Database (fbg_planning)
 *
 * Provides tool definitions and handlers for year plan presentations.
 */

import { Pool } from 'pg';
import { Type, FunctionDeclaration } from '@google/genai';

// PostgreSQL connection pool for year plan database
let yearPlanPool: Pool | null = null;

function getYearPlanPool(): Pool {
  if (!yearPlanPool) {
    const connectionString = process.env.DATABASE_URL_YEARPLAN;
    console.log('[YearPlan DB] DATABASE_URL_YEARPLAN exists:', !!connectionString);
    console.log('[YearPlan DB] Connection string starts with:', connectionString?.substring(0, 30) || 'EMPTY');

    if (!connectionString) {
      throw new Error('DATABASE_URL_YEARPLAN environment variable is not set');
    }

    yearPlanPool = new Pool({
      connectionString,
      ssl: false, // Local connection via SSH tunnel, no SSL needed
    });
  }
  return yearPlanPool;
}

/**
 * Gemini FunctionDeclarations for year plan tools
 */
export const yearPlanGeminiTools: FunctionDeclaration[] = [
  {
    name: 'query_year_plan',
    description: `Query activities from the year plan database (fbg_planning).

Tables:
- activities: Events/activities with title, description, dates, responsible, status, etc.
- focus_areas: Categories like Service & Kompetens, Platsutveckling, etc.
- strategic_concepts: Top-level groupings

Activity fields: id, title, description, start_date, end_date, responsible, purpose, theme, target_group, status ('ongoing'/'decided'/'completed'), weeks (array of week numbers)

Focus areas for "Verksamhetsplanering":
- Service & Kompetens (#93C5FD)
- Platsutveckling (#86EFAC)
- Etablering & Innovation (#FCA5A5)
- Övrigt (#9CA3AF)

Available filters:
- year: Filter by year (e.g., 2026)
- status: 'ongoing', 'decided', or 'completed'
- quarter: 1-4 (Q1=Jan-Mar, Q2=Apr-Jun, Q3=Jul-Sep, Q4=Oct-Dec)
- half: 1 or 2 (H1=Jan-Jun, H2=Jul-Dec)
- focusAreaId: UUID of focus area
- conceptId: UUID of strategic concept

Returns activities with joined focus_area_name, focus_area_color, and concept_name.`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        year: {
          type: Type.NUMBER,
          description: 'Filter by year (e.g., 2026)',
        },
        status: {
          type: Type.STRING,
          description: 'Filter by status: ongoing, decided, or completed',
        },
        quarter: {
          type: Type.NUMBER,
          description: 'Filter by quarter (1-4)',
        },
        half: {
          type: Type.NUMBER,
          description: 'Filter by half year (1 or 2)',
        },
        focusAreaId: {
          type: Type.STRING,
          description: 'Filter by focus area UUID',
        },
        conceptId: {
          type: Type.STRING,
          description: 'Filter by strategic concept UUID',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_year_plan_summary',
    description: `Get summary statistics for year plan activities.

Returns:
- byStatus: Array of { status, count } - activities per status
- byFocusArea: Array of { focus_area, color, count } - activities per focus area
- byMonth: Array of { month, count } - activities per month (1-12)

Use this to create overview charts and key metrics.`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        year: {
          type: Type.NUMBER,
          description: 'Filter by year (e.g., 2026)',
        },
        conceptId: {
          type: Type.STRING,
          description: 'Filter by strategic concept UUID',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_focus_areas',
    description: `Get all focus areas with their strategic concepts and colors.

Returns array of focus areas with:
- id: UUID
- name: Focus area name (e.g., "Service & Kompetens")
- color: Hex color code (e.g., "#93C5FD")
- start_month, end_month: Time period (for time-based concepts)
- concept_name, concept_id: Parent strategic concept

Use this to understand the organizational structure and get correct colors.`,
    parameters: {
      type: Type.OBJECT,
      properties: {},
      required: [],
    },
  },
];

/**
 * Execute a year plan tool call
 */
export async function executeYearPlanTool(toolName: string, args: any): Promise<any> {
  switch (toolName) {
    case 'query_year_plan':
      return await executeQueryYearPlan(args);

    case 'get_year_plan_summary':
      return await executeGetSummary(args);

    case 'get_focus_areas':
      return await executeGetFocusAreas();

    default:
      throw new Error(`Unknown year plan tool: ${toolName}`);
  }
}

/**
 * Query year plan activities with filters
 */
async function executeQueryYearPlan(args: {
  year?: number;
  status?: string;
  quarter?: number;
  half?: number;
  focusAreaId?: string;
  conceptId?: string;
}): Promise<any> {
  try {
    const pool = getYearPlanPool();

    let whereConditions: string[] = [];
    let queryParams: any[] = [];
    let paramIndex = 1;

    // Year filter
    if (args.year) {
      whereConditions.push(`EXTRACT(YEAR FROM a.start_date) = $${paramIndex}`);
      queryParams.push(args.year);
      paramIndex++;
    }

    // Status filter
    if (args.status) {
      whereConditions.push(`a.status = $${paramIndex}`);
      queryParams.push(args.status);
      paramIndex++;
    }

    // Concept filter
    if (args.conceptId) {
      whereConditions.push(`fa.concept_id = $${paramIndex}`);
      queryParams.push(args.conceptId);
      paramIndex++;
    }

    // Focus area filter
    if (args.focusAreaId) {
      whereConditions.push(`a.focus_area_id = $${paramIndex}`);
      queryParams.push(args.focusAreaId);
      paramIndex++;
    }

    // Quarter filter (Q1=Jan-Mar, Q2=Apr-Jun, Q3=Jul-Sep, Q4=Oct-Dec)
    if (args.quarter) {
      const startMonth = (args.quarter - 1) * 3 + 1;
      const endMonth = args.quarter * 3;
      whereConditions.push(`EXTRACT(MONTH FROM a.start_date) BETWEEN $${paramIndex} AND $${paramIndex + 1}`);
      queryParams.push(startMonth, endMonth);
      paramIndex += 2;
    }

    // Half filter (H1=Jan-Jun, H2=Jul-Dec)
    if (args.half) {
      const startMonth = args.half === 1 ? 1 : 7;
      const endMonth = args.half === 1 ? 6 : 12;
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
      LIMIT 100
    `;

    const result = await pool.query(query, queryParams);

    return {
      success: true,
      count: result.rows.length,
      activities: result.rows,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get summary statistics
 */
async function executeGetSummary(args: { year?: number; conceptId?: string }): Promise<any> {
  try {
    const pool = getYearPlanPool();

    let whereConditions: string[] = [];
    let queryParams: any[] = [];
    let paramIndex = 1;

    if (args.year) {
      whereConditions.push(`EXTRACT(YEAR FROM a.start_date) = $${paramIndex}`);
      queryParams.push(args.year);
      paramIndex++;
    }

    if (args.conceptId) {
      whereConditions.push(`fa.concept_id = $${paramIndex}`);
      queryParams.push(args.conceptId);
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
        EXTRACT(MONTH FROM a.start_date)::int as month,
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

    // Calculate total
    const total = statusResult.rows.reduce((sum, row) => sum + parseInt(row.count), 0);

    return {
      success: true,
      total,
      byStatus: statusResult.rows,
      byFocusArea: focusAreaResult.rows,
      byMonth: monthResult.rows,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get all focus areas
 */
async function executeGetFocusAreas(): Promise<any> {
  try {
    const pool = getYearPlanPool();

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

    return {
      success: true,
      count: result.rows.length,
      focusAreas: result.rows,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Cleanup function
 */
export async function closeYearPlanConnections() {
  if (yearPlanPool) await yearPlanPool.end();
}
