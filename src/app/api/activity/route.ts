import { NextResponse } from 'next/server';
import { isDatabaseConfigured } from '@/db/env';
import { listResearch as listDbResearch } from '@/db/repositories/research-repository';
import { listCampaigns as listDbCampaigns } from '@/db/repositories/campaign-repository';
import { listResearch as listFileResearch } from '@/marcom/memory/research-store';
import { readProjects as listFileProjects } from '@/marcom/memory/project-store';
import { listPersonalizations } from '@/marcom/memory/personalization-store';
import { resolveLocalPilotActor } from '@/db/local-actor';
import type { ResearchEntry } from '@/marcom/schemas/research-record';

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

interface ActivityItem {
  id: string;
  agentName: string;
  agentColor: 'blue' | 'pink' | 'purple' | 'cyan';
  action: string;
  target: string;
  timestamp: string;
  sortTime: number;
}

export async function GET() {
  try {
    let projects: Array<{
      project_id: string;
      name: string;
      configuration_updated_at?: string | null;
      configuration_revision?: number | null;
    }> = [];

    let isDb = isDatabaseConfigured();
    let actor: any = null;

    if (isDb) {
      try {
        actor = await resolveLocalPilotActor();
        projects = await listDbCampaigns(actor);
      } catch (e) {
        console.warn('Database listCampaigns failed, falling back to JSON project store:', e);
        isDb = false;
        projects = listFileProjects();
      }
    } else {
      projects = listFileProjects();
    }

    const activities: ActivityItem[] = [];

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

      let research: ResearchEntry[] = [];
      if (isDb && actor) {
        try {
          research = await listDbResearch(actor, p.project_id);
        } catch {
          research = listFileResearch(p.project_id);
        }
      } else {
        research = listFileResearch(p.project_id);
      }

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
            latestProspect: r.record?.identity?.name || r.seed?.name || 'Prospect',
          });
        } else {
          existing.count += 1;
          if (t > existing.lastTime) {
            existing.lastTime = t;
            existing.latestProspect = r.record?.identity?.name || r.seed?.name || 'Prospect';
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
        .filter((r) => r.review?.reviewed_at)
        .sort((a, b) => new Date(b.review!.reviewed_at).getTime() - new Date(a.review!.reviewed_at).getTime())
        .slice(0, 4);

      for (const r of recentResearched) {
        const { formatted, sortTime } = formatTimestamp(r.review!.reviewed_at);
        activities.push({
          id: `res-${r.record?.record_id ?? Math.random()}`,
          agentName: 'Research Agent',
          agentColor: 'purple',
          action: `verified & saved ${r.record?.identity?.name || r.seed?.name || 'Prospect'}`,
          target: p.name,
          timestamp: formatted,
          sortTime: sortTime - 100, // keep slightly below batch completion if same timestamp
        });
      }

      // 4. Personalization Agent Activities
      const personalizations = listPersonalizations(p.project_id);
      if (personalizations.length > 0) {
        const latestPersTime = Math.max(
          ...personalizations.map((pe) => new Date(pe.updated_at || pe.generated_at).getTime()),
          0,
        );
        if (latestPersTime > 0) {
          const { formatted, sortTime } = formatTimestamp(latestPersTime);
          activities.push({
            id: `pers-batch-${p.project_id}`,
            agentName: 'Personalization Agent',
            agentColor: 'pink',
            action: `tailored cold outreach & contact routes for ${personalizations.length} prospects`,
            target: p.name,
            timestamp: formatted,
            sortTime: sortTime + 50,
          });
        }

        // Individual personalized prospects
        const recentPersonalized = [...personalizations]
          .sort((a, b) => new Date(b.updated_at || b.generated_at).getTime() - new Date(a.updated_at || a.generated_at).getTime())
          .slice(0, 4);

        for (const pe of recentPersonalized) {
          const timeMs = new Date(pe.updated_at || pe.generated_at).getTime();
          const { formatted, sortTime } = formatTimestamp(timeMs);
          const channel = pe.strategy?.recommended_channel ? `via ${pe.strategy.recommended_channel}` : '';
          const targetDesc = pe.strategy?.contact_audit?.best_contact_target ? ` (${pe.strategy.contact_audit.best_contact_target})` : '';

          activities.push({
            id: `pers-${pe.record_id}-${timeMs}`,
            agentName: 'Personalization Agent',
            agentColor: 'pink',
            action: `personalized outreach ${channel} & audited contact route for ${pe.prospect_name}${targetDesc}`,
            target: p.name,
            timestamp: formatted,
            sortTime,
          });
        }
      }
    }

    // Sort descending by true timestamp
    activities.sort((a, b) => b.sortTime - a.sortTime);

    // Return the last 10 genuine actions
    return NextResponse.json(activities.slice(0, 10));
  } catch (err) {
    console.error('Error fetching activities:', err);
    return NextResponse.json([], { status: 200 });
  }
}
