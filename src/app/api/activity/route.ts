import { NextResponse } from 'next/server';
import { readProjects } from '@/marcom/memory/project-store';
import { listResearch } from '@/marcom/memory/research-store';

function formatTimestamp(isoString?: string | number | null): { formatted: string; sortTime: number } {
  const d = isoString ? new Date(isoString) : new Date();
  const sortTime = d.getTime();
  
  const isToday = new Date().toDateString() === d.toDateString();
  const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  
  return {
    formatted: isToday ? `Today, ${timeStr}` : `${dateStr}, ${timeStr}`,
    sortTime,
  };
}

export async function GET() {
  const projects = readProjects();
  const activities: any[] = [];
  
  for (const p of projects) {
    // 1. Project Configuration Event
    if (p.configuration_updated_at) {
      const { formatted, sortTime } = formatTimestamp(p.configuration_updated_at);
      activities.push({
        id: `config-${p.project_id}-${p.configuration_revision ?? 1}`,
        agentName: 'Brief Analyzer',
        agentColor: 'blue',
        action: 'structured & updated campaign brief',
        target: p.name,
        timestamp: formatted,
        sortTime,
      });
    }

    const research = listResearch(p.project_id);

    // 2. Batch Summary Events
    const batchMap = new Map<number, { count: number; lastTime: number; latestProspect: string }>();
    for (const r of research) {
      const bNum = r.batch_number ?? 1;
      const t = r.review?.reviewed_at ? new Date(r.review.reviewed_at).getTime() : 0;
      const existing = batchMap.get(bNum);
      if (!existing) {
        batchMap.set(bNum, { 
          count: 1, 
          lastTime: t, 
          latestProspect: r.record.identity.name || r.seed.name 
        });
      } else {
        existing.count += 1;
        if (t > existing.lastTime) {
          existing.lastTime = t;
          existing.latestProspect = r.record.identity.name || r.seed.name;
        }
      }
    }

    // Add each batch completion event
    for (const [batchNum, batchData] of batchMap.entries()) {
      const { formatted, sortTime } = formatTimestamp(batchData.lastTime || Date.now());
      activities.push({
        id: `batch-${p.project_id}-${batchNum}`,
        agentName: 'Research Agent',
        agentColor: 'cyan',
        action: `finished Batch ${batchNum} (${batchData.count} ${batchData.count === 1 ? 'prospect' : 'prospects'} discovered)`,
        target: p.name,
        timestamp: formatted,
        sortTime,
      });
    }

    // 3. Recent Individual Researched Prospects (top recent entries)
    const recentResearched = research
      .filter(r => r.review?.reviewed_at)
      .sort((a, b) => new Date(b.review!.reviewed_at).getTime() - new Date(a.review!.reviewed_at).getTime())
      .slice(0, 4);

    for (const r of recentResearched) {
      const { formatted, sortTime } = formatTimestamp(r.review!.reviewed_at);
      activities.push({
        id: `res-${r.record.record_id}`,
        agentName: 'Research Agent',
        agentColor: 'purple',
        action: `verified & saved ${r.record.identity.name || r.seed.name}`,
        target: p.name,
        timestamp: formatted,
        sortTime: sortTime - 100, // keep slightly below batch completion if same timestamp
      });
    }
  }

  // Sort descending by true timestamp
  activities.sort((a, b) => b.sortTime - a.sortTime);

  // Return the last 6-7 genuine actions
  return NextResponse.json(activities.slice(0, 7));
}
