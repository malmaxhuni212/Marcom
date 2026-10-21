import { NextResponse } from 'next/server';
import { createServerMemoryStore } from '@/marcom/memory/server-store';
import { listResearch, updateResearchReview } from '@/db/repositories/research-repository';
import { authorizeApiRequest } from '@/auth/access';
import {
  deletePersonalization,
  getPersonalization,
  getPersonalizationSettings,
  listPersonalizations,
  savePersonalization,
  savePersonalizationSettings,
  summarizePersonalizations,
  updatePersonalizationCopy,
  updatePersonalizationStatus,
} from '@/db/repositories/personalization-repository';
import { runPersonalizationAgent } from '@/marcom/agents/personalization/agent';
import { PersonalizationSettingsSchema } from '@/marcom/schemas/personalization';
import type { EvaluatedRoute, PersonalizationEntry } from '@/marcom/schemas/personalization';
import { GeneratePersonalizationRequestSchema } from '@/marcom/personalization/request-contract';

export const runtime = 'nodejs';
export const maxDuration = 300;

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: RouteCtx) {
  const access = await authorizeApiRequest(req);
  if (!access.ok) return access.response;
  const { id: projectId } = await params;
  const store = await createServerMemoryStore(access.actor, access.allowFileFallback);
  const actor = access.actor;
  const project = store.projects().find((p) => p.project_id === projectId);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const url = new URL(req.url);
  const recordId = url.searchParams.get('recordId');
  const batch = url.searchParams.get('batch');
  const status = url.searchParams.get('status');

  const settings = await getPersonalizationSettings(actor, projectId);
  const allEntries = await listPersonalizations(actor, projectId);
  const allResearch = await listResearch(actor, projectId);
  const researchMap = new Map(allResearch.map((r) => [r.record.record_id, r.record]));

  const enrichEntry = (e: PersonalizationEntry): PersonalizationEntry => {
    const rec = researchMap.get(e.record_id);
    const emails = (rec?.public_contact?.filter((c) => c.kind === 'email').map((c) => c.value) || []).filter(Boolean);
    const phones = (rec?.public_contact?.filter((c) => c.kind === 'phone').map((c) => c.value) || []).filter(Boolean);
    const linkedin_urls = (rec?.social_profiles?.filter((s) => s.platform === 'linkedin').map((s) => s.profile_url).filter(Boolean) || []);
    const websites = (rec?.websites?.map((w) => w.url).filter(Boolean) || []);

    const candidate_contacts = {
      emails,
      linkedin_urls,
      websites,
      phones,
    };

    let strategy = e.strategy;
    if (strategy && !strategy.contact_audit) {
      const recChannel = strategy.recommended_channel;
      let primaryTarget = 'No direct contact found';

      if (recChannel === 'linkedin' && linkedin_urls.length > 0) {
        primaryTarget = linkedin_urls.find((u) => u.includes('/in/')) || linkedin_urls[0];
      } else if (recChannel === 'phone' && phones.length > 0) {
        primaryTarget = phones[0];
      } else if (recChannel === 'email' && emails.length > 0) {
        primaryTarget = emails[0];
      } else {
        primaryTarget =
          linkedin_urls.find((u) => u.includes('/in/')) ||
          emails[0] ||
          linkedin_urls[0] ||
          phones[0] ||
          websites[0] ||
          'No direct contact found';
      }

      const isEmail = primaryTarget.includes('@');
      const isLinkedIn = primaryTarget.includes('linkedin');
      const isPhone = primaryTarget.startsWith('+') || /^[0-9\s-()]+$/.test(primaryTarget);
      const isForm = primaryTarget.startsWith('http') && !isLinkedIn;

      const evaluated_routes: EvaluatedRoute[] = [
        ...emails.map((em): EvaluatedRoute => {
          const isGeneric = /^(info|contact|enquiries|support|submissions|admin|press|hello)@/i.test(em);
          const isFake = /^(abuse|privacy|whois|hostmaster|postmaster)@/i.test(em);
          const isRecommended = em === primaryTarget;
          return {
            channel: 'email' as const,
            value: em,
            verdict: isRecommended ? 'recommended' : isFake ? 'unusable_or_fake' : isGeneric ? 'generic_gatekeeper' : 'viable_backup',
            quality_assessment: isFake ? 'Technical abuse/WHOIS address - unusable' : isGeneric ? 'Generic/role-based team inbox' : 'Direct verified email',
            priority: isRecommended ? 1 : isGeneric ? 3 : 2,
          };
        }),
        ...linkedin_urls.map((li): EvaluatedRoute => {
          const isPersonal = li.includes('/in/');
          const isRecommended = li === primaryTarget;
          return {
            channel: 'linkedin' as const,
            value: li,
            verdict: isRecommended ? 'recommended' : isPersonal ? 'viable_backup' : 'generic_gatekeeper',
            quality_assessment: isPersonal ? 'Personal LinkedIn profile (direct 1-to-1 route)' : 'Company LinkedIn page',
            priority: isRecommended ? 1 : 2,
          };
        }),
        ...phones.map((ph): EvaluatedRoute => {
          const isRecommended = ph === primaryTarget;
          return {
            channel: 'phone' as const,
            value: ph,
            verdict: isRecommended ? 'recommended' : 'viable_backup',
            quality_assessment: 'Verified business phone number for direct contact',
            priority: isRecommended ? 1 : 2,
          };
        }),
        ...websites.map((ws): EvaluatedRoute => {
          const isRecommended = ws === primaryTarget;
          return {
            channel: 'website' as const,
            value: ws,
            verdict: isRecommended ? 'recommended' : 'viable_backup',
            quality_assessment: 'Official website / inquiries portal',
            priority: isRecommended ? 1 : 3,
          };
        }),
      ];

      strategy = {
        ...strategy,
        contact_audit: {
          best_channel: isEmail ? 'email' : isLinkedIn ? 'linkedin' : isPhone ? 'phone' : isForm ? 'contact_form' : 'other',
          best_contact_target: primaryTarget,
          why_best_route: isLinkedIn
            ? 'Personal LinkedIn profile offers highest engagement for direct 1-to-1 outreach, bypassing gatekeepers.'
            : isPhone
            ? 'Direct telephone line discovered in research dossier; immediate direct route.'
            : isEmail
            ? 'Verified email address discovered in research dossier.'
            : 'Website destination discovered in research dossier.',
          is_direct_contact: Boolean(isLinkedIn && primaryTarget.includes('/in/')) || (isEmail && !/^(info|contact|admin)@/i.test(primaryTarget)),
          email_status: emails.length > 0 ? (/^(info|contact|admin)@/i.test(emails[0]) ? 'generic_inbox' : 'verified_direct') : 'not_available',
          backup_route: (isLinkedIn ? emails[0] : linkedin_urls[0]) || websites[0] || null,
          evaluated_routes,
        },
      };
    }

    return {
      ...e,
      strategy,
      candidate_contacts,
    };
  };

  const enrichedEntries = allEntries.map(enrichEntry);

  if (recordId) {
    const item = enrichedEntries.find((e) => e.record_id === recordId);
    return item
      ? NextResponse.json({ item, settings })
      : NextResponse.json({ error: 'Personalization not found for this record' }, { status: 404 });
  }

  let filtered = enrichedEntries;
  if (batch && batch !== 'all') {
    filtered = filtered.filter((e) => e.batch_id === batch || String(e.batch_number) === batch.replace('batch-', ''));
  }
  if (status && status !== 'all') {
    filtered = filtered.filter((e) => e.status === status);
  }

  const summary = summarizePersonalizations(allEntries);

  return NextResponse.json({
    items: filtered,
    summary,
    settings,
  });
}

export async function POST(req: Request, { params }: RouteCtx) {
  const access = await authorizeApiRequest(req);
  if (!access.ok) return access.response;
  const { id: projectId } = await params;
  const store = await createServerMemoryStore(access.actor, access.allowFileFallback);
  const actor = access.actor;
  const project = store.projects().find((p) => p.project_id === projectId);
  if (!project?.structured_brief) {
    return NextResponse.json({ error: 'Project or structured brief not found' }, { status: 404 });
  }

  const parsedBody = GeneratePersonalizationRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: parsedBody.error.issues[0]?.message ?? 'Invalid personalization request.' },
      { status: 400 },
    );
  }
  const body = parsedBody.data;
  const { recordId, recordIds, batchId } = body;
  const mode = body.allShortlisted ? 'all_shortlisted' : (body.mode ?? 'single');
  const forceRegenerate = Boolean(body.forceRegenerate || body.force);

  const allResearch = await listResearch(actor, projectId);
  const settings = await getPersonalizationSettings(actor, projectId);

  // Targets to personalize
  let candidates = allResearch;

  if (recordIds) {
    const selected = new Set(recordIds);
    candidates = allResearch.filter((r) => selected.has(r.record.record_id));
    if (candidates.length !== selected.size) {
      return NextResponse.json({ error: 'One or more selected research records were not found.' }, { status: 404 });
    }
  } else if (mode === 'single' && recordId) {
    candidates = allResearch.filter((r) => r.record.record_id === recordId);
    if (!candidates.length) {
      return NextResponse.json({ error: 'Research record not found' }, { status: 404 });
    }
  } else if (mode === 'batch' && batchId) {
    candidates = allResearch.filter(
      (r) => r.batch_id === batchId || String(r.batch_number) === String(batchId).replace('batch-', ''),
    );
  } else if (mode === 'all_personalized' || mode === 'all_shortlisted') {
    // Leads marked 'shortlisted' (Personalized) in human review
    candidates = allResearch.filter((r) => r.review?.status === 'shortlisted');
  }

  if (!candidates.length) {
    return NextResponse.json(
      { error: 'No matching prospects found to personalize with the selected filter.' },
      { status: 400 },
    );
  }

  const results: PersonalizationEntry[] = [];
  const errors: { record_id: string; error: string }[] = [];

  for (const researchEntry of candidates) {
    const existing = await getPersonalization(actor, projectId, researchEntry.record.record_id);
    if (existing && !forceRegenerate && existing.status !== 'failed') {
      results.push(existing);
      continue;
    }

    try {
      const generated = await runPersonalizationAgent({
        projectId,
        brief: project.structured_brief,
        entry: researchEntry,
        settings,
        store,
        force: forceRegenerate,
      });

      await savePersonalization(actor, projectId, generated);
      await updateResearchReview(actor, projectId, researchEntry.record.record_id, 'shortlisted', 'Personalized by Agent 3');
      results.push(generated);
    } catch (err) {
      console.error(JSON.stringify({
        event: 'personalization.prospect.failed',
        campaignId: projectId,
        recordId: researchEntry.record.record_id,
        errorType: err instanceof Error ? err.name : 'UnknownError',
      }));
      errors.push({
        record_id: researchEntry.record.record_id,
        error: 'Outreach generation failed for this prospect.',
      });
    }
  }

  if (!results.length) {
    return NextResponse.json(
      {
        success: false,
        error: errors[0]?.error || 'No outreach drafts were generated.',
        processed: 0,
        errors,
        items: [],
      },
      { status: 502 },
    );
  }

  const allUpdated = await listPersonalizations(actor, projectId);
  const summary = summarizePersonalizations(allUpdated);

  return NextResponse.json({
    success: true,
    processed: results.length,
    errors,
    results,
    items: results,
    summary,
  });
}

/** Human review decisions and draft edits */
export async function PATCH(req: Request, { params }: RouteCtx) {
  const access = await authorizeApiRequest(req);
  if (!access.ok) return access.response;
  const { id: projectId } = await params;
  const body = await req.json().catch(() => ({}));
  const recordId = typeof body.recordId === 'string' ? body.recordId : body.record_id;
  const { copy, status, reviewer_note } = body;

  if (!recordId) {
    return NextResponse.json({ error: 'recordId is required' }, { status: 400 });
  }

  let updated: PersonalizationEntry | null = null;

  if (copy) {
    updated = await updatePersonalizationCopy(access.actor, projectId, recordId, copy);
  }

  if (status) {
    updated = await updatePersonalizationStatus(access.actor, projectId, recordId, status, reviewer_note);
  }

  return updated
    ? NextResponse.json({ success: true, item: updated, items: [updated] })
    : NextResponse.json({ error: 'Personalization entry not found' }, { status: 404 });
}

/** Save campaign outreach settings (sender info, campaign facts, etc.) */
export async function PUT(req: Request, { params }: RouteCtx) {
  const access = await authorizeApiRequest(req);
  if (!access.ok) return access.response;
  const { id: projectId } = await params;
  const body = await req.json().catch(() => ({}));

  try {
    const parsed = PersonalizationSettingsSchema.partial().parse(body);
    const updated = await savePersonalizationSettings(access.actor, projectId, parsed);
    return NextResponse.json({ success: true, settings: updated });
  } catch (err) {
    return NextResponse.json(
      { error: 'Invalid settings format: ' + (err as Error).message },
      { status: 400 },
    );
  }
}

export async function DELETE(req: Request, { params }: RouteCtx) {
  const access = await authorizeApiRequest(req);
  if (!access.ok) return access.response;
  const { id: projectId } = await params;
  const url = new URL(req.url);
  const recordId = url.searchParams.get('recordId');

  if (!recordId) {
    return NextResponse.json({ error: 'recordId is required' }, { status: 400 });
  }

  const ok = await deletePersonalization(access.actor, projectId, recordId);
  return ok ? NextResponse.json({ success: true }) : NextResponse.json({ error: 'Not found' }, { status: 404 });
}
