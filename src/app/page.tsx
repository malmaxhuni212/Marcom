import AppShell from '@/components/workspace/AppShell';
import TodayView from '@/components/workspace/views/TodayView';

export default function HomePage() {
  return (
    <AppShell>
      <TodayView />
    </AppShell>
  );
}
