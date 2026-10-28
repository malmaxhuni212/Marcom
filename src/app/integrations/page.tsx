'use client';

import AppShell, { PageFrame } from '@/components/workspace/AppShell';
import { Icon, Pill, card, serif } from '@/components/workspace/ui';

const INTEGRATIONS = [
  {
    name: 'Email (Copy & Paste)',
    status: 'Active',
    active: true,
    description:
      'MARCOM writes full emails with subject lines from verified facts. Copy any subject and body straight into Gmail, Outlook or Apple Mail.',
  },
  {
    name: 'LinkedIn (Copy & Paste)',
    status: 'Active',
    active: true,
    description:
      'Short connection notes and InMail messages formatted within LinkedIn character limits, ready to copy and paste onto the prospect profile.',
  },
  {
    name: 'Web Search & Verification',
    status: 'Connected',
    active: true,
    description:
      'Live web search provider used by the Research agent to discover prospects and verify claims against primary sources.',
  },
];

export default function IntegrationsPage() {
  return (
    <AppShell>
      <PageFrame className="max-w-[1160px] gap-6">
        <header className="flex flex-col gap-1">
          <h1 className={`${serif} m-0 text-[32px]`}>Integrations</h1>
          <p className="m-0 text-sm text-[#A7ADB8]">
            Connected research and outreach channels. Outreach is configured for manual review and copy-to-clipboard so nothing is ever sent automatically.
          </p>
        </header>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-4">
          {INTEGRATIONS.map((item) => (
            <article key={item.name} className={`${card} flex flex-col gap-3 p-5`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#1F232B] text-[#5ED3DF]">
                    <Icon name="plug" size={18} />
                  </span>
                  <h2 className="m-0 text-base font-semibold text-[#F1F2F4]">{item.name}</h2>
                </div>
                <Pill bg="#133524" fg="#5BD69A">
                  {item.status}
                </Pill>
              </div>
              <p className="m-0 text-sm leading-relaxed text-[#A7ADB8]">{item.description}</p>
            </article>
          ))}
        </div>
      </PageFrame>
    </AppShell>
  );
}
