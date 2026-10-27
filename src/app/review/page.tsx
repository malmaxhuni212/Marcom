import AppShell from '@/components/workspace/AppShell';
import ProspectsView from '@/components/workspace/views/ProspectsView';

export default function ReviewPage() {
  return (
    <AppShell>
      <ProspectsView initialTab="needs_review" />
    </AppShell>
  );
}
