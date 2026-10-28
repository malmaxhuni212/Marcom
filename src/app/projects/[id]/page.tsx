'use client';

import { use, useEffect } from 'react';
import AppShell from '@/components/workspace/AppShell';
import { useWorkspace } from '@/components/workspace/WorkspaceContext';
import OverviewView from '@/components/workspace/views/OverviewView';

function SyncAndRenderOverview({ projectId }: { projectId: string }) {
  const { activeId, setActiveId } = useWorkspace();
  useEffect(() => {
    if (projectId && activeId !== projectId) {
      setActiveId(projectId);
    }
  }, [projectId, activeId, setActiveId]);
  return <OverviewView />;
}

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <AppShell>
      <SyncAndRenderOverview projectId={id} />
    </AppShell>
  );
}
