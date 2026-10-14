import { NextResponse } from 'next/server';
import { readProjects } from '@/marcom/memory/project-store';
import { listResearch } from '@/marcom/memory/research-store';
import { listPersonalizations } from '@/marcom/memory/personalization-store';

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  timestamp: string;
  sortTime: number;
  type: 'success' | 'info' | 'agent' | 'warning';
  icon: string;
  link?: string;
  projectName?: string;
}

function formatRelativeTime(timestampMs: number): string {
  const diffMs = Date.now() - timestampMs;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffMin < 2) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay === 1) return 'Yesterday';
  if (diffDay < 7) return `${diffDay}d ago`;

  const d = new Date(timestampMs);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export async function GET() {
  const projects = readProjects();
  const notifications: NotificationItem[] = [];
  let totalPersonalizationsCount = 0;

  for (const p of projects) {
    const research = listResearch(p.project_id);

    // 1. Batches Completed
    const batchMap = new Map<number, { count: number; lastTime: number; batchId: string }>();
    for (const r of research) {
      const bNum = r.batch_number ?? 1;
      const bId = r.batch_id ?? `batch-${bNum}`;
      const t = r.review?.reviewed_at ? new Date(r.review.reviewed_at).getTime() : 0;
      const existing = batchMap.get(bNum);
      if (!existing) {
        batchMap.set(bNum, { count: 1, lastTime: t, batchId: bId });
      } else {
        existing.count += 1;
        if (t > existing.lastTime) {
          existing.lastTime = t;
        }
      }
    }

    const sortedBatches = Array.from(batchMap.entries()).sort((a, b) => b[0] - a[0]);

    for (const [batchNum, bData] of sortedBatches) {
      const sortTime = bData.lastTime || Date.now();
      notifications.push({
        id: `notif-batch-${p.project_id}-${batchNum}`,
        title: `Research Batch ${batchNum} Finished`,
        message: `Discovered and verified ${bData.count} evidence-backed ${bData.count === 1 ? 'prospect' : 'prospects'} for "${p.name}".`,
        timestamp: formatRelativeTime(sortTime),
        sortTime,
        type: 'success',
        icon: '🔍',
        link: `/projects/${p.project_id}/research?batch=${encodeURIComponent(bData.batchId)}`,
        projectName: p.name,
      });
    }

    // 2. Total Research Milestone
    if (research.length > 0) {
      const latestTime = Math.max(...research.map(r => r.review?.reviewed_at ? new Date(r.review.reviewed_at).getTime() : 0), 0);
      const sortTime = latestTime ? latestTime - 500 : Date.now() - 500;
      notifications.push({
        id: `notif-milestone-${p.project_id}`,
        title: 'Prospect Database Updated',
        message: `${research.length} total qualified leads across ${batchMap.size} batches in "${p.name}".`,
        timestamp: formatRelativeTime(sortTime),
        sortTime,
        type: 'agent',
        icon: '📊',
        link: `/projects/${p.project_id}/research`,
        projectName: p.name,
      });
    }

    // 3. Campaign Brief Update
    if (p.configuration_updated_at) {
      const sortTime = new Date(p.configuration_updated_at).getTime();
      notifications.push({
        id: `notif-brief-${p.project_id}`,
        title: 'Campaign Brief Analyzed',
        message: `Brief Analyzer structured search criteria and target audiences for "${p.name}".`,
        timestamp: formatRelativeTime(sortTime),
        sortTime,
        type: 'info',
        icon: '📝',
        link: `/projects/${p.project_id}`,
        projectName: p.name,
      });
    }

    // 4. Personalization Agent Milestones & Outreach Ready
    const personalizations = listPersonalizations(p.project_id);
    totalPersonalizationsCount += personalizations.length;

    if (personalizations.length > 0) {
      const latestPersTime = Math.max(
        ...personalizations.map((pe) => new Date(pe.updated_at || pe.generated_at).getTime()),
        0
      );

      // Milestone notification
      notifications.push({
        id: `notif-pers-milestone-${p.project_id}`,
        title: 'Personalized Outreach Generated',
        message: `${personalizations.length} prospects prepared with verified hooks, contact routes, and custom copy for "${p.name}".`,
        timestamp: formatRelativeTime(latestPersTime || Date.now()),
        sortTime: latestPersTime || Date.now(),
        type: 'agent',
        icon: '✍️',
        link: `/outreach`,
        projectName: p.name,
      });

      // Top recent personalized leads (up to 3)
      const sortedPers = [...personalizations].sort(
        (a, b) => new Date(b.updated_at || b.generated_at).getTime() - new Date(a.updated_at || a.generated_at).getTime()
      );

      for (const pe of sortedPers.slice(0, 3)) {
        const timeMs = new Date(pe.updated_at || pe.generated_at).getTime();
        const bestTarget = pe.strategy?.contact_audit?.best_contact_target;
        const channel = pe.strategy?.recommended_channel ? `${pe.strategy.recommended_channel}` : 'outreach';
        notifications.push({
          id: `notif-pers-${pe.record_id}-${timeMs}`,
          title: `Outreach Ready: ${pe.prospect_name}`,
          message: `Tailored ${channel} copy and verified destination (${bestTarget || 'route audited'}) ready for "${p.name}".`,
          timestamp: formatRelativeTime(timeMs),
          sortTime: timeMs,
          type: 'success',
          icon: '✨',
          link: `/outreach`,
          projectName: p.name,
        });
      }
    }
  }

  // 5. System Status (only if no personalizations yet)
  if (totalPersonalizationsCount === 0) {
    notifications.push({
      id: 'notif-system-agent-personalizer',
      title: 'Personalization Agent Ready',
      message: 'Pipeline initialized to generate tailored cold outreach hooks for personalized prospects.',
      timestamp: 'Today',
      sortTime: Date.now() - 1000 * 60 * 120,
      type: 'agent',
      icon: '✨',
    });
  }

  // Sort descending by true timestamp
  notifications.sort((a, b) => b.sortTime - a.sortTime);

  // Return the top important recent items (up to 8)
  return NextResponse.json(notifications.slice(0, 8));
}
