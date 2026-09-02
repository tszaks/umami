'use client';
import { Column, Grid, Text } from '@umami/react-zen';
import { WebsiteControls } from '@/app/(main)/websites/[websiteId]/WebsiteControls';
import { LoadingPanel } from '@/components/common/LoadingPanel';
import { Panel } from '@/components/common/Panel';
import { useTrafficQualityStatsQuery } from '@/components/hooks';
import type { TrafficQualityMetricSet } from '@/components/hooks/queries/useTrafficQualityStatsQuery';
import { MetricCard } from '@/components/metrics/MetricCard';
import { MetricsBar } from '@/components/metrics/MetricsBar';
import { formatLongNumber } from '@/lib/format';

function QualityMetrics({ data }: { data: TrafficQualityMetricSet }) {
  const bounceRate = data.visits ? (Math.min(data.visits, data.bounces) / data.visits) * 100 : 0;

  return (
    <MetricsBar>
      <MetricCard value={data.visitors} label="Visitors" formatValue={formatLongNumber} />
      <MetricCard value={data.visits} label="Visits" formatValue={formatLongNumber} />
      <MetricCard value={data.pageviews} label="Views" formatValue={formatLongNumber} />
      <MetricCard value={bounceRate} label="Bounce rate" formatValue={n => `${Math.round(n)}%`} />
    </MetricsBar>
  );
}

export function TrafficQualityPage({ websiteId }: { websiteId: string }) {
  const { data, isLoading, isFetching, error } = useTrafficQualityStatsQuery(websiteId);

  return (
    <Column gap>
      <WebsiteControls websiteId={websiteId} />
      <LoadingPanel
        data={data}
        isLoading={isLoading}
        isFetching={isFetching}
        error={error}
        minHeight="320px"
      >
        {data && (
          <Column gap>
            <Panel
              title="Traffic quality"
              description="Raw traffic is always retained. The additional views separate known QA and visits that warrant human review; nothing is silently deleted."
            >
              <Grid columns="repeat(auto-fit, minmax(320px, 1fr))" gap>
                <Panel title="Raw" description="Every measured visit in the selected period.">
                  <QualityMetrics data={data.raw} />
                </Panel>
                <Panel
                  title="QA-clean"
                  description="Raw traffic with explicit QA and preview activity removed."
                >
                  <QualityMetrics data={data.qaClean} />
                </Panel>
                <Panel
                  title="Likely business"
                  description="QA-clean traffic after the review signals below are separated."
                >
                  <QualityMetrics data={data.business} />
                </Panel>
                <Panel
                  title="Suspected nonbusiness"
                  description="A review queue, not a bot verdict. Inspect before excluding from decisions."
                >
                  <QualityMetrics data={data.suspected} />
                </Panel>
              </Grid>
            </Panel>
            <Panel title="Classification rules">
              <Column gap="3">
                <Text>
                  <strong>QA excluded:</strong> {data.definitions.qa}
                </Text>
                <Text>
                  <strong>Suspected nonbusiness:</strong> {data.definitions.suspected}
                </Text>
                <Text color="muted">
                  QA-only activity in this period: {formatLongNumber(data.qa.visits)} visits and{' '}
                  {formatLongNumber(data.qa.pageviews)} views.
                </Text>
              </Column>
            </Panel>
          </Column>
        )}
      </LoadingPanel>
    </Column>
  );
}
