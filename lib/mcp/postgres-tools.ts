import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { Pool } from 'pg';

// Initialize connection pools (will be configured from env vars)
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

/**
 * Query FBG Analytics database (company_financials, job_postings, etc.)
 */
export const queryFbgAnalyticsTool = tool(
  'query_fbg_analytics',
  'Query the FBG Analytics database for company financial data, employment statistics, job postings, and education data. Contains tables: company_financials, education_cohort_data, job_postings, scb_employment_stats.',
  {
    query: z.string().describe('SQL SELECT query to execute'),
    params: z.array(z.any()).optional().describe('Query parameters for parameterized queries'),
  },
  async (args) => {
    try {
      const pool = getFbgAnalyticsPool();
      const result = await pool.query(args.query, args.params);

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            rowCount: result.rowCount,
            rows: result.rows,
            fields: result.fields.map(f => ({ name: f.name, dataType: f.dataTypeID })),
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            error: error instanceof Error ? error.message : 'Unknown error',
            hint: 'Check your SQL syntax and table/column names. Use LIMIT to avoid large results.'
          }, null, 2)
        }],
        isError: true
      };
    }
  }
);

// Cleanup function to close pools
export async function closePostgresPools() {
  if (fbgAnalyticsPool) await fbgAnalyticsPool.end();
}
