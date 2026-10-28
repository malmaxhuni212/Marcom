'use client';

import { use, useEffect } from 'react';
import AppShell from '@/components/workspace/AppShell';
import { useWorkspace } from '@/components/workspace/WorkspaceContext';
import ProspectsView from '@/components/workspace/views/ProspectsView';

function SyncAndRenderProspects({ projectId }: { projectId: string }) {
  const { activeId, setActiveId } = useWorkspace();
  useEffect(() => {
    if (projectId && activeId !== projectId) {
      setActiveId(projectId);
    }
  }, [projectId, activeId, setActiveId]);
  return <ProspectsView />;
}

export default function ProjectResearchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <AppShell>
      <SyncAndRenderProspects projectId={id} />
    </AppShell>
  );
}
