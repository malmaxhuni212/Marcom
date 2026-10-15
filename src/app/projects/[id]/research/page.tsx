import ProspectReviewTable from '@/components/research/ProspectReviewTable';

export default async function CampaignResearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ prospect?: string; batch?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  return <ProspectReviewTable projectId={id} initialProspectId={query.prospect} initialBatch={query.batch} />;
}
