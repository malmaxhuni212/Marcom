import AppShell from '@/components/workspace/AppShell';
import ProspectsView from '@/components/workspace/views/ProspectsView';

export default function OutreachPage() {
  return (
    <AppShell>
      <ProspectsView initialTab="shortlisted" />
    </AppShell>
  );
}
