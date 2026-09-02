import { afterEach, describe, expect, test, vi } from 'vitest';

async function loadModule(mode: 'prisma' | 'clickhouse') {
  vi.resetModules();
  const prismaRawQuery = vi.fn().mockResolvedValue([]);
  const clickhouseRawQuery = vi.fn().mockResolvedValue([]);

  vi.doMock('@/lib/db', () => ({
    CLICKHOUSE: 'clickhouse',
    PRISMA: 'prisma',
    runQuery: vi.fn((queries: Record<string, () => unknown>) => queries[mode]()),
  }));
  vi.doMock('@/lib/prisma', () => ({ default: { rawQuery: prismaRawQuery } }));
  vi.doMock('@/lib/clickhouse', () => ({ default: { rawQuery: clickhouseRawQuery } }));

  const mod = await import('./getTrafficQualityStats');
  return { ...mod, prismaRawQuery, clickhouseRawQuery };
}

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe('getTrafficQualityStats', () => {
  test('postgres keeps raw data and produces mutually exclusive review buckets', async () => {
    const { getTrafficQualityStats, prismaRawQuery } = await loadModule('prisma');
    await getTrafficQualityStats('website-1', {
      startDate: new Date('2026-08-01T00:00:00Z'),
      endDate: new Date('2026-09-01T00:00:00Z'),
    });

    const [sql] = prismaRawQuery.mock.calls[0];
    expect(sql).toContain("select 'raw' as scope");
    expect(sql).toContain("select 'qaClean' as scope");
    expect(sql).toContain("select 'suspected' as scope");
    expect(sql).toContain("when is_qa = 1 then 'qa'");
    expect(sql).toContain("lower(coalesce(session.city, '')) = 'boardman'");
    expect(sql).toContain("lower(coalesce(session.screen, '')) = '800x600'");
  });

  test('clickhouse uses the same QA and suspected signals', async () => {
    const { getTrafficQualityStats, clickhouseRawQuery } = await loadModule('clickhouse');
    await getTrafficQualityStats('website-1', {
      startDate: new Date('2026-08-01T00:00:00Z'),
      endDate: new Date('2026-09-01T00:00:00Z'),
    });

    const [sql] = clickhouseRawQuery.mock.calls[0];
    expect(sql).toContain("select 'qaClean' as scope");
    expect(sql).toContain("lower(ifNull(screen, '')) = '800x600'");
    expect(sql).toContain("lower(ifNull(city, '')) = 'boardman'");
  });
});
