import type { Metadata } from 'next';
import { TrafficQualityPage } from './TrafficQualityPage';

export default async function ({ params }: { params: Promise<{ websiteId: string }> }) {
  const { websiteId } = await params;
  return <TrafficQualityPage websiteId={websiteId} />;
}

export const metadata: Metadata = {
  title: 'Traffic quality',
};
