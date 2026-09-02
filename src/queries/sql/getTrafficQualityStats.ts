import clickhouse from '@/lib/clickhouse';
import { EVENT_TYPE } from '@/lib/constants';
import { CLICKHOUSE, PRISMA, runQuery } from '@/lib/db';
import prisma from '@/lib/prisma';
import type { QueryFilters } from '@/lib/types';

const FUNCTION_NAME = 'getTrafficQualityStats';

export type TrafficQualityScope = 'raw' | 'qaClean' | 'business' | 'suspected' | 'qa';

export interface TrafficQualityStats {
  scope: TrafficQualityScope;
  pageviews: number;
  visitors: number;
  visits: number;
  bounces: number;
  totaltime: number;
}

const POSTGRES_VISITS = `
  with visits as (
    select
      website_event.session_id,
      website_event.visit_id,
      sum(case when website_event.event_type not in (2, 5) then 1 else 0 end) as pageviews,
      min(case when website_event.event_type not in (2, 5) then website_event.created_at end) as min_time,
      max(case when website_event.event_type not in (2, 5) then website_event.created_at end) as max_time,
      max(case when website_event.event_type = ${EVENT_TYPE.customEvent} then 1 else 0 end) as has_custom_event,
      max(case when
        coalesce(website_event.hostname, '') ~* '(^localhost$|^127\\.0\\.0\\.1$|\\.vercel\\.app$)'
        or coalesce(website_event.utm_source, '') ~* '(^|[-_])(qa|test|selftest)([-_]|$)'
        or coalesce(website_event.utm_campaign, '') ~* '(^|[-_])(qa|test|selftest)([-_]|$)'
        or coalesce(website_event.utm_content, '') ~* '(^|[-_])(qa|test|selftest)([-_]|$)'
        or coalesce(website_event.url_path, '') ~* '^/(qa|test|self-test)(/|$)'
        or coalesce(website_event.event_name, '') ~* '(^|[-_])(qa|selftest)([-_]|$)'
        then 1 else 0 end) as is_qa,
      max(case when
        upper(coalesce(session.country, '')) = 'CN'
        or lower(coalesce(session.language, '')) like 'zh%'
        or lower(coalesce(session.screen, '')) = '800x600'
        or lower(coalesce(session.city, '')) = 'boardman'
        then 1 else 0 end) as is_suspected
    from website_event
    inner join session
      on session.session_id = website_event.session_id
      and session.website_id = website_event.website_id
    where website_event.website_id = {{websiteId::uuid}}
      and website_event.created_at between {{startDate}} and {{endDate}}
      and website_event.event_type != ${EVENT_TYPE.performance}
    group by website_event.session_id, website_event.visit_id
    having sum(case when website_event.event_type not in (2, 5) then 1 else 0 end) > 0
  ), classified as (
    select *, case when is_qa = 1 then 'qa' when is_suspected = 1 then 'suspected' else 'business' end as bucket
    from visits
  ), scopes as (
    select 'raw' as scope, * from classified
    union all
    select 'qaClean' as scope, * from classified where bucket != 'qa'
    union all
    select 'business' as scope, * from classified where bucket = 'business'
    union all
    select 'suspected' as scope, * from classified where bucket = 'suspected'
    union all
    select 'qa' as scope, * from classified where bucket = 'qa'
  )
`;

const CLICKHOUSE_VISITS = `
  with visits as (
    select
      session_id,
      visit_id,
      countIf(event_type not in (2, 5)) as pageviews,
      minIf(created_at, event_type not in (2, 5)) as min_time,
      maxIf(created_at, event_type not in (2, 5)) as max_time,
      max(event_type = ${EVENT_TYPE.customEvent}) as has_custom_event,
      max(
        match(lower(ifNull(hostname, '')), '(^localhost$|^127\\.0\\.0\\.1$|\\.vercel\\.app$)')
        or match(lower(ifNull(utm_source, '')), '(^|[-_])(qa|test|selftest)([-_]|$)')
        or match(lower(ifNull(utm_campaign, '')), '(^|[-_])(qa|test|selftest)([-_]|$)')
        or match(lower(ifNull(utm_content, '')), '(^|[-_])(qa|test|selftest)([-_]|$)')
        or match(lower(ifNull(url_path, '')), '^/(qa|test|self-test)(/|$)')
        or match(lower(ifNull(event_name, '')), '(^|[-_])(qa|selftest)([-_]|$)')
      ) as is_qa,
      max(
        upper(ifNull(country, '')) = 'CN'
        or startsWith(lower(ifNull(language, '')), 'zh')
        or lower(ifNull(screen, '')) = '800x600'
        or lower(ifNull(city, '')) = 'boardman'
      ) as is_suspected
    from website_event
    where website_id = {websiteId:UUID}
      and created_at between {startDate:DateTime64} and {endDate:DateTime64}
      and event_type != ${EVENT_TYPE.performance}
    group by session_id, visit_id
    having pageviews > 0
  ), classified as (
    select *, multiIf(is_qa = 1, 'qa', is_suspected = 1, 'suspected', 'business') as bucket
    from visits
  ), scopes as (
    select 'raw' as scope, * from classified
    union all
    select 'qaClean' as scope, * from classified where bucket != 'qa'
    union all
    select 'business' as scope, * from classified where bucket = 'business'
    union all
    select 'suspected' as scope, * from classified where bucket = 'suspected'
    union all
    select 'qa' as scope, * from classified where bucket = 'qa'
  )
`;

export async function getTrafficQualityStats(
  websiteId: string,
  filters: QueryFilters,
): Promise<TrafficQualityStats[]> {
  const params = {
    websiteId,
    startDate: filters.startDate,
    endDate: filters.endDate,
  };

  return runQuery({
    [PRISMA]: () =>
      prisma.rawQuery(
        `${POSTGRES_VISITS}
        select
          scope,
          cast(coalesce(sum(pageviews), 0) as bigint) as pageviews,
          count(distinct session_id) as visitors,
          count(distinct visit_id) as visits,
          cast(coalesce(sum(case when pageviews = 1 and has_custom_event = 0 then 1 else 0 end), 0) as bigint) as bounces,
          cast(coalesce(sum(extract(epoch from (max_time - min_time))), 0) as bigint) as totaltime
        from scopes
        group by scope`,
        params,
        FUNCTION_NAME,
      ),
    [CLICKHOUSE]: () =>
      clickhouse.rawQuery(
        `${CLICKHOUSE_VISITS}
        select
          scope,
          sum(pageviews) as pageviews,
          uniq(session_id) as visitors,
          uniq(visit_id) as visits,
          sum(pageviews = 1 and has_custom_event = 0) as bounces,
          sum(max_time - min_time) as totaltime
        from scopes
        group by scope`,
        params,
        FUNCTION_NAME,
      ),
  });
}
