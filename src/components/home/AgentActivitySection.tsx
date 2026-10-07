'use client';

import SectionHeader from '@/components/ui/SectionHeader';
import type { AgentActivity } from '@/types';

export default function AgentActivitySection() {
  const colorMap = {
    blue: 'bg-accent-blue/10 border-accent-blue/20 text-accent-blue',
    pink: 'bg-accent-pink/10 border-accent-pink/20 text-accent-pink',
    purple: 'bg-accent-purple/10 border-accent-purple/20 text-accent-purple',
    amber: 'bg-accent-amber/10 border-accent-amber/20 text-accent-amber',
    cyan: 'bg-accent-cyan/10 border-accent-cyan/20 text-accent-cyan',
  };

  // Currently we return empty state since we don't have real activity feed implemented yet
  // The user explicitly requested to NOT use fake/mock data in production
  const activities: AgentActivity[] = []; // removed recentActivity mock usage

  return (
    <section className="py-6 h-full flex flex-col">
      <SectionHeader 
        title="Recent Activity" 
        subtitle="Live feed of agent operations." 
        className="mb-6"
      />

      <div className="flex-1 flex flex-col gap-3">
        {activities.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center border border-dashed border-white/[0.08] rounded-2xl p-6">
            <svg className="w-6 h-6 text-white/20 mb-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-[13px] text-white/40 text-center">No recent activity.</p>
            <p className="text-[11px] text-white/20 text-center mt-1">Agent operations will appear here.</p>
          </div>
        ) : (
          activities.map((activity) => (
            <div key={activity.id} className="flex items-start gap-4 p-4 rounded-2xl bg-white/[0.02] border border-white/[0.04] hover:bg-white/[0.04] transition-colors">
              <div className={`w-8 h-8 rounded-xl border flex items-center justify-center shrink-0 ${colorMap[activity.agentColor as keyof typeof colorMap]}`}>
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                </svg>
              </div>
              
              <div className="flex-1 min-w-0 pt-0.5">
                <p className="text-[13px] text-white/80 leading-relaxed">
                  <span className="font-semibold text-white/90">{activity.agentName}</span> {activity.action} in <span className="font-medium text-white/90">{activity.target}</span>.
                </p>
                <div className="flex items-center gap-2 mt-1.5">
                  <span className="text-[11px] text-white/40">{activity.timestamp}</span>
                </div>
              </div>
            </div>
          ))
        )}

        {activities.length > 0 && (
          <button className="w-full p-3 rounded-xl border border-dashed border-white/[0.08] text-[12px] font-medium text-white/40 hover:text-white/70 hover:bg-white/[0.02] hover:border-white/[0.12] transition-all mt-1">
            View All Activity
          </button>
        )}
      </div>
    </section>
  );
}
