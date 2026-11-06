'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { authenticatedFetch } from '@/auth/client';
import AppShell, { PageFrame } from '@/components/workspace/AppShell';
import {
  Icon,
  Pill,
  card,
  btnPrimary,
  btnSecondary,
  btnDanger,
  inputClass,
  serif,
} from '@/components/workspace/ui';

interface AccessiblePageOption {
  id: string;
  title: string;
  url: string;
  parentType?: string;
}

interface NotionStatus {
  connected: boolean;
  workspaceName?: string | null;
  workspaceIcon?: string | null;
  connectedAt?: string | null;
  oauthConfigured?: boolean;
  defaultParentPageId?: string | null;
  defaultParentPageTitle?: string | null;
  accessiblePages?: AccessiblePageOption[];
}

const STATIC_INTEGRATIONS = [
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

function IntegrationsContent() {
  const searchParams = useSearchParams();
  const [notionStatus, setNotionStatus] = useState<NotionStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isSavingParent, setIsSavingParent] = useState(false);
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    const notionParam = searchParams.get('notion');
    const errorParam = searchParams.get('notion_error');

    if (notionParam === 'connected') {
      setBanner({
        type: 'success',
        message:
          'Notion workspace connected! Open any campaign and click "Sync to Notion" to publish its Campaign Hub, Prospects Database, and outreach drafts.',
      });
    } else if (notionParam === 'disconnected') {
      setBanner({
        type: 'success',
        message: 'Notion workspace disconnected.',
      });
    } else if (errorParam) {
      setBanner({
        type: 'error',
        message: `Notion connection failed: ${decodeURIComponent(errorParam)}`,
      });
    }

    void fetchNotionStatus();
  }, [searchParams]);

  async function fetchNotionStatus() {
    setIsLoading(true);
    try {
      const res = await authenticatedFetch('/api/integrations/notion/status?includePages=1');
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setNotionStatus(data);
      }
    } catch {
      // Ignore network error on initial load
    } finally {
      setIsLoading(false);
    }
  }

  async function handleParentPageChange(pageId: string) {
    if (!notionStatus) return;
    const chosen = notionStatus.accessiblePages?.find((p) => p.id === pageId) ?? null;
    setIsSavingParent(true);
    try {
      const res = await authenticatedFetch('/api/integrations/notion/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          defaultParentPageId: pageId || null,
          defaultParentPageTitle: chosen?.title ?? null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setNotionStatus((prev) =>
          prev
            ? {
                ...prev,
                defaultParentPageId: data.defaultParentPageId,
                defaultParentPageTitle: data.defaultParentPageTitle,
              }
            : prev,
        );
        setBanner({
          type: 'success',
          message: chosen
            ? `Campaign Hubs will now be created inside "${chosen.title}".`
            : 'Updated default Notion parent page.',
        });
      } else {
        setBanner({
          type: 'error',
          message: data.error || 'Could not update default Notion parent page.',
        });
      }
    } catch (err) {
      setBanner({
        type: 'error',
        message: (err as Error).message || 'Could not update default Notion parent page.',
      });
    } finally {
      setIsSavingParent(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm('Are you sure you want to disconnect your Notion workspace?')) return;
    setIsDisconnecting(true);
    try {
      const res = await authenticatedFetch('/api/integrations/notion/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setNotionStatus({ connected: false });
        setBanner({ type: 'success', message: 'Notion disconnected successfully.' });
      } else {
        setBanner({
          type: 'error',
          message: data.error || `Failed to disconnect (${res.status}).`,
        });
      }
    } catch (err) {
      setBanner({
        type: 'error',
        message: (err as Error).message || 'Failed to disconnect Notion.',
      });
    } finally {
      setIsDisconnecting(false);
    }
  }

  function handleConnect() {
    window.location.href = '/api/integrations/notion/auth';
  }

  const accessiblePages = notionStatus?.accessiblePages ?? [];
  const activeParentId =
    notionStatus?.defaultParentPageId || accessiblePages[0]?.id || '';

  return (
    <PageFrame className="max-w-[1160px] gap-6">
      <header className="flex flex-col gap-1">
        <h1 className={`${serif} m-0 text-[32px]`}>Integrations</h1>
        <p className="m-0 text-sm text-[#A7ADB8]">
          Connected research, documentation, and outreach channels. Export briefs, review prospects, and sync outreach copy seamlessly.
        </p>
      </header>

      {banner && (
        <div
          className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-sm ${
            banner.type === 'success'
              ? 'border-[#1B4D3E] bg-[#0E2A22] text-[#5BD69A]'
              : 'border-[#4D1B1B] bg-[#2A0E0E] text-[#F28B82]'
          }`}
        >
          <div className="flex items-center gap-2">
            <Icon name={banner.type === 'success' ? 'check' : 'warning'} size={16} />
            <span>{banner.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setBanner(null)}
            className="text-xs opacity-70 hover:opacity-100"
          >
            ✕
          </button>
        </div>
      )}

      {/* Featured Integration: Notion */}
      <section className={`${card} flex flex-col gap-4 border-[#2E6B75]/40 bg-[#151B22] p-6`}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#1F2633] text-2xl font-bold text-[#F1F2F4]">
              N
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="m-0 text-lg font-semibold text-[#F1F2F4]">Notion Workspace</h2>
                <span className="rounded-md bg-[#2E6B75]/20 px-2 py-0.5 text-[11px] font-medium text-[#5ED3DF]">
                  On-Demand Campaign Hub
                </span>
              </div>
              <p className="m-0 text-xs text-[#A7ADB8]">
                Sync selected campaign briefs, prospect intelligence databases, and personalized outreach drafts directly into Notion.
              </p>
            </div>
          </div>

          <div>
            {isLoading ? (
              <span className="text-xs text-[#8A909C]">Checking connection…</span>
            ) : notionStatus?.connected ? (
              <div className="flex flex-wrap items-center gap-2">
                <Pill bg="#133524" fg="#5BD69A">
                  Connected 🟢 {notionStatus.workspaceName ? `· ${notionStatus.workspaceName}` : ''}
                </Pill>
                <button
                  type="button"
                  onClick={handleConnect}
                  className={`${btnSecondary} !py-1.5 !px-3 text-xs`}
                  title="Update which Notion pages are shared with Marcom"
                >
                  <Icon name="refresh" size={13} /> Update pages
                </button>
                <button
                  type="button"
                  onClick={handleDisconnect}
                  disabled={isDisconnecting}
                  className={`${btnDanger} !py-1.5 !px-3 text-xs`}
                >
                  {isDisconnecting ? 'Disconnecting…' : 'Disconnect'}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleConnect}
                className={`${btnPrimary} !py-2 !px-4 text-xs font-semibold`}
              >
                <Icon name="plug" size={14} /> Connect to Notion
              </button>
            )}
          </div>
        </div>

        {notionStatus?.connected && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#2A2F39] bg-[#10141A] px-4 py-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-semibold text-[#F1F2F4]">
                Destination Parent Page in Notion
              </span>
              <span className="text-xs text-[#8A909C]">
                {accessiblePages.length > 0
                  ? 'New Campaign Hubs are created inside this shared Notion page when you click "Sync to Notion" on a project.'
                  : 'No shared Notion pages detected yet. Click "Update pages" above and grant access to at least one page in Notion.'}
              </span>
            </div>
            {accessiblePages.length > 0 && (
              <div className="flex items-center gap-2">
                <select
                  aria-label="Destination Parent Page in Notion"
                  value={activeParentId}
                  disabled={isSavingParent}
                  onChange={(e) => void handleParentPageChange(e.target.value)}
                  className={`${inputClass} !w-auto min-w-[230px] !py-2 text-xs`}
                >
                  {accessiblePages.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}

        <div className="rounded-xl border border-[#2A2F39] bg-[#0E1014] p-3 text-xs leading-relaxed text-[#A7ADB8]">
          <strong className="text-[#C9CDD4]">What syncs to Notion (on-demand per campaign):</strong>
          <ul className="m-0 mt-1 list-disc space-y-0.5 pl-4">
            <li>
              <strong>Campaign Hub Page:</strong> Primary goal, pipeline snapshot, target audience criteria, and outreach guardrails.
            </li>
            <li>
              <strong>Prospects Review Database:</strong> Fit rating &amp; score, verification badge, review &amp; outreach status, verified contact channels, and top subject line.
            </li>
            <li>
              <strong>Prospect Dossier &amp; Outreach Drafts:</strong> Full email copy, LinkedIn DM, follow-up sequence, alternative opening, qualification checklist, and clickable source links inside each prospect page.
            </li>
          </ul>
        </div>
      </section>

      {/* Other Channels */}
      <h2 className="m-0 text-base font-semibold text-[#F1F2F4]">Other Built-In Channels</h2>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-4">
        {STATIC_INTEGRATIONS.map((item) => (
          <article key={item.name} className={`${card} flex flex-col gap-3 p-5`}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#1F232B] text-[#5ED3DF]">
                  <Icon name="plug" size={18} />
                </span>
                <h3 className="m-0 text-base font-semibold text-[#F1F2F4]">{item.name}</h3>
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
  );
}

export default function IntegrationsPage() {
  return (
    <AppShell>
      <Suspense fallback={<div className="p-8 text-sm text-[#A7ADB8]">Loading integrations…</div>}>
        <IntegrationsContent />
      </Suspense>
    </AppShell>
  );
}
