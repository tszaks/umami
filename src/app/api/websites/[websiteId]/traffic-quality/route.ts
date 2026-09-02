import { getQueryFilters, parseRequest } from '@/lib/request';
import { json, unauthorized } from '@/lib/response';
import { withDateRange } from '@/lib/schema';
import { canViewWebsiteSection } from '@/permissions';
import {
  getTrafficQualityStats,
  type TrafficQualityScope,
  type TrafficQualityStats,
} from '@/queries/sql';

const scopes: TrafficQualityScope[] = ['raw', 'qaClean', 'business', 'suspected', 'qa'];

export async function GET(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  const { auth, query, error } = await parseRequest(request, withDateRange({}));
  if (error) return error();

  const { websiteId } = await params;
  if (!(await canViewWebsiteSection(auth, websiteId, 'overview'))) return unauthorized();

  const filters = await getQueryFilters(query, websiteId);
  const rows = await getTrafficQualityStats(websiteId, filters);
  const empty = { pageviews: 0, visitors: 0, visits: 0, bounces: 0, totaltime: 0 };
  const data = Object.fromEntries(
    scopes.map(scope => {
      const row = rows.find(item => item.scope === scope);
      return [
        scope,
        row
          ? {
              pageviews: row.pageviews,
              visitors: row.visitors,
              visits: row.visits,
              bounces: row.bounces,
              totaltime: row.totaltime,
            }
          : empty,
      ];
    }),
  ) as Record<TrafficQualityScope, Omit<TrafficQualityStats, 'scope'>>;

  return json({
    ...data,
    definitions: {
      qa: 'Localhost, loopback, Vercel preview hosts, explicit QA/test campaigns, QA routes, and self-test events.',
      suspected:
        'Visits matching at least one review signal: China, a Chinese browser language, 800x600 screen, or Boardman data-center location.',
    },
  });
}
