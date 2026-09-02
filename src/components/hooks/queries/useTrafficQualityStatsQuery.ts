import { useDateParameters } from '@/components/hooks/useDateParameters';
import { useApi } from '../useApi';

export interface TrafficQualityMetricSet {
  pageviews: number;
  visitors: number;
  visits: number;
  bounces: number;
  totaltime: number;
}

export interface TrafficQualityStatsData {
  raw: TrafficQualityMetricSet;
  qaClean: TrafficQualityMetricSet;
  business: TrafficQualityMetricSet;
  suspected: TrafficQualityMetricSet;
  qa: TrafficQualityMetricSet;
  definitions: {
    qa: string;
    suspected: string;
  };
}

export function useTrafficQualityStatsQuery(websiteId: string) {
  const { get, useQuery } = useApi();
  const { startAt, endAt } = useDateParameters();

  return useQuery<TrafficQualityStatsData>({
    queryKey: ['websites:traffic-quality', { websiteId, startAt, endAt }],
    queryFn: () => get(`/websites/${websiteId}/traffic-quality`, { startAt, endAt }),
    enabled: !!websiteId,
  });
}
