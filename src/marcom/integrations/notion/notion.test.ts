import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildCampaignBriefBlocks,
  buildProspectPageBodyBlocks,
  buildProspectPageProperties,
  buildProspectsDatabaseSchema,
  normalizeEmail,
  normalizeHttpUrl,
  sanitizeSelectOption,
  splitTextChunks,
} from './builder';
import {
  buildNotionAuthUrl,
  createNotionOAuthState,
  filterAndRankAccessiblePages,
  getNotionOAuthConfig,
  verifyNotionOAuthState,
} from './client';
import {
  disconnectNotion,
  getNotionConnection,
  getProjectNotionConnection,
  getProjectNotionSync,
  resolveNotionSessionScope,
  sanitizeProjectSyncRecordForClient,
  saveNotionConnection,
  serializeNotionConnectionCookie,
} from './store';
import {
  markDeletedProjectRecordsInNotion,
  pullNotionChangesForProject,
  syncConnectedProjectRecordsToNotion,
  syncProjectToNotion,
} from './sync';
import type { StructuredBrief } from '@/marcom/schemas/structured-brief';
import type { ResearchEntry } from '@/marcom/schemas/research-record';
import type { PersonalizationEntry } from '@/marcom/schemas/personalization';

function mockBrief(): StructuredBrief {
  return {
    structured_brief_version: '1.0',
    project: {
      name: 'Maya Poetry Book Awards',
      description: 'Annual contemporary poetry book competition',
      primary_objective: 'Drive 2,000+ submissions from published UK/US poets',
      secondary_objectives: ['Build community of literary writers'],
      success_metrics: ['2,000 submissions', '150 partnerships'],
    },
    targets: [
      {
        id: 'target-1',
        target_type: 'Authors, Poets & Writers',
        entity_kind: 'person',
        description: 'Published poets and facilitators',
        geography_mode: 'specified',
        geography: ['United Kingdom', 'United States'],
        qualification_criteria: [
          { text: 'Published UK Poet', origin: 'explicit', needs_operational_definition: false },
        ],
        exclusion_criteria: [
          {
            text: 'Unpublished or amateur writing only',
            origin: 'explicit',
            needs_operational_definition: false,
          },
        ],
        priority: 'primary',
      },
    ],
    research: {
      required_fields: ['name', 'email', 'role'],
      preferred_source_types: ['author_website', 'press'],
      evidence_requirements: ['Published collections citation'],
      verification_requirements: ['Primary domain or verified press'],
      unknown_handling: 'flag',
    },
    personalization: {
      allowed: [],
      preferred_details: [],
      tone: ['professional'],
      avoid: [],
    },
    outreach: {
      objectives: ['Invite submissions'],
      channels: ['email', 'linkedin'],
      tone: ['professional'],
      approval_required: true,
    },
    database: { fields: [] },
    human_review: { requirements: [], approval_points: [] },
    constraints: ['Never overstate prize amounts'],
    conflicts: [],
    approximations: [],
    unknowns_requiring_confirmation: [],
  };
}

function mockResearchEntry(recordId = 'rec-test-1', name = 'Dr Kerry Ryan'): ResearchEntry {
  return {
    record: {
      research_record_version: '1.1',
      record_id: recordId,
      project_id: 'proj-1',
      brief_target_id: 'target-1',
      identity: {
        name,
        entity_kind: 'person',
        identity_verified: true,
      },
      target_type: 'Authors, Poets & Writers',
      role: 'Poet & Workshop Facilitator',
      organisation: 'Folkestone Lit Lab',
      country: 'United Kingdom',
      location: 'Folkestone, England',
      websites: [{ url: 'https://kerryryan.co.uk', type: 'author', title: 'Kerry Ryan Official' }],
      social_profiles: [
        {
          platform: 'linkedin',
          profile_url: 'https://www.linkedin.com/in/kerry-ryan-poet',
          username: 'kerry-ryan-poet',
          display_name: 'Kerry Ryan',
          verified_status: true,
          confidence: 'verified',
          source_ids: ['S1'],
        },
        {
          platform: 'instagram',
          profile_url: 'https://instagram.com/kerrypoet',
          username: 'kerrypoet',
          display_name: 'Kerry Ryan',
          verified_status: true,
          confidence: 'verified',
          source_ids: ['S2'],
        },
      ],
      public_contact: [
        {
          kind: 'email',
          value: 'mailto:kerry@example.com',
          is_professional: true,
          source_ids: ['S1'],
          confidence: 'verified',
        },
        {
          kind: 'phone',
          value: '+44 20 7946 0958',
          is_professional: true,
          source_ids: ['S1'],
          confidence: 'likely',
        },
      ],
      key_contacts: [
        {
          name: 'Hannah Cole',
          role: 'Literary Agent',
          department: 'Poetry',
          email: 'hannah@litagency.co.uk',
          linkedin_url: 'https://www.linkedin.com/in/hannah-cole',
          phone: null,
          relevance: 'Represents UK poetry submissions',
          confidence: 'verified',
          source_ids: ['S1'],
        },
      ],
      background: ['MA in Creative Writing', 'Resident poet at Folkestone Harbour'],
      work_and_projects: ['Published The Good Other in 2024'],
      achievements: ['Shortlisted for Forward Prize'],
      industry_activity: ['Regular workshop host across Kent'],
      qualification_assessment: [
        {
          criterion: 'Published UK Poet',
          status: 'met',
          note: 'Has 2 published collections with UK presses',
          source_ids: ['S1', 'S2'],
        },
      ],
      reason_for_relevance: 'Actively publishing UK poet fitting the literary award criteria',
      fit: {
        score: 88,
        band: 'strong',
        rationale: 'Demonstrated publication track record matching award category guidelines',
      },
      summary: 'Prominent British poet and community writing facilitator based in Kent.',
      evidence: [
        {
          claim: 'Dr Kerry Ryan published The Good Other',
          field: 'work_and_projects',
          source_ids: ['S1'],
          quote: 'Kerry Ryan published her second collection The Good Other with Blueprint Press',
          confidence: 'verified',
        },
      ],
      sources: [
        {
          id: 'S1',
          url: 'https://kerryryan.co.uk/about',
          title: 'About Dr Kerry Ryan',
          source_type: 'author_website',
          retrieved_at: '2026-10-29T12:00:00Z',
        },
      ],
      unknowns: [{ field: 'tour_schedule', reason: '2027 tour schedule not yet announced' }],
      contradictions: [],
      research_confidence: 'high',
      matched_prospect_id: null,
      researched_at: '2026-10-29T12:00:00Z',
      research_agent_version: '1.2.0',
    },
    review: {
      project_id: 'proj-1',
      record_id: recordId,
      status: 'shortlisted',
      reviewed_at: '2026-10-29T13:00:00Z',
      reviewed_by: 'local-pilot',
      note: 'Priority poet for UK outreach wave 1',
    },
    seed: { name, website: 'https://kerryryan.co.uk' },
    qa: { status: 'passed', issues: [] },
    relationship_status: null,
    model: 'openai/gpt-oss-20b',
    ai_provider: 'groq',
    searches: ['Kerry Ryan poet Folkestone'],
    search_provider: 'exa',
    search_request_ids: ['req-1'],
    search_usage: { requests: 1, estimated_cost_usd: 0.001, latency_ms: 100 },
    search_warnings: [],
  };
}

function mockPersonalization(longEmail = false): PersonalizationEntry {
  const repeatedParagraph =
    'Your recent collection The Good Other stood out for how thoughtfully it weaves coastal place-writing into contemporary form.\n\n';
  const emailBody = longEmail
    ? `Dear Dr. Ryan,\n\n${repeatedParagraph.repeat(18)}Warm regards,\nMaya Awards Team`
    : 'Dear Dr. Ryan,\n\nI admired your work on The Good Other...';

  return {
    personalization_version: '1.0',
    record_id: 'rec-test-1',
    project_id: 'proj-1',
    prospect_name: 'Dr Kerry Ryan',
    target_type: 'Authors, Poets & Writers',
    batch_id: null,
    batch_number: null,
    status: 'approved',
    strategy: {
      readiness: 'ready',
      readiness_reason: 'Verified contact and high relevance',
      prospect_snapshot: 'British poet based in Kent',
      recipient_priorities: 'Publishing quality poetry',
      relevance_thesis: 'Matches category criteria',
      campaign_objective: 'Submissions',
      outreach_goal: 'Invitation to submit',
      recipient_incentive: 'Recognition and £10,000 award prize',
      hooks: [
        {
          id: 'H1',
          fact: 'Published The Good Other in 2024',
          evidence_quote: null,
          source_ids: ['S1'],
          why_it_resonates: 'Recent flagship collection',
          strength: 'strong',
        },
      ],
      primary_hook_id: 'H1',
      recommended_channel: 'email',
      angle: 'Highlight shared themes in The Good Other',
      channel_reason: 'Direct verified email ensures deliverability',
      avoid: ['Do not use generic congratulatory flattery'],
      human_checks: ['Verify recipient is accepting submissions'],
    } as any,
    copy: {
      subject_lines: [
        { text: 'Maya Poetry Book Awards — Note on The Good Other', style: 'value' },
        { text: 'Submission invitation for Dr Kerry Ryan', style: 'direct' },
      ],
      email_body: emailBody,
      alternative_opening: 'Alternatively, start with a focus on Folkestone Harbour...',
      linkedin_message: 'Hi Kerry, following your poetry publications in Kent...',
      follow_up_body: 'Hi Kerry, just following up on our invitation...',
      hook_usage: 'Used The Good Other in opening line',
    },
    ai_copy: null,
    edited_by_human: false,
    qa: null,
    auto_revisions: 0,
    models: { strategist: 'test', writer: 'test' },
    timings_ms: { strategist: 100, writer: 100 },
    generated_at: '2026-10-29T14:30:00Z',
    updated_at: '2026-10-29T14:30:00Z',
    reviewed_at: null,
    reviewer_note: null,
    error: null,
  };
}

test('Notion OAuth config, auth URL, and HMAC state signing/verification', () => {
  const prevId = process.env.NOTION_CLIENT_ID;
  const prevSecret = process.env.NOTION_CLIENT_SECRET;
  try {
    process.env.NOTION_CLIENT_ID = 'test-client-id-mock-notion-oauth';
    process.env.NOTION_CLIENT_SECRET = 'secret_test_notion_signing_key';

    const config = getNotionOAuthConfig();
    assert.equal(config.isConfigured, true);
    assert.equal(config.clientId, 'test-client-id-mock-notion-oauth');

    const state = createNotionOAuthState({
      workspaceId: 'ws-123',
      returnOrigin: 'http://127.0.0.1:3000',
    });
    const verified = verifyNotionOAuthState(state);
    assert.equal(verified.valid, true);
    assert.equal(verified.workspaceId, 'ws-123');
    assert.equal(verified.returnOrigin, 'http://127.0.0.1:3000');

    // Reject tampered signature
    const tampered = `${state.slice(0, -4)}XXXX`;
    assert.equal(verifyNotionOAuthState(tampered).valid, false);

    // Reject expired token
    const expiredState = createNotionOAuthState({ ttlSeconds: -5 });
    assert.equal(verifyNotionOAuthState(expiredState).valid, false);

    const authUrl = buildNotionAuthUrl(
      'https://example.com/api/integrations/notion/callback',
      state,
    );
    assert.ok(authUrl.startsWith('https://api.notion.com/v1/oauth/authorize'));
    assert.ok(authUrl.includes('client_id=test-client-id-mock-notion-oauth'));
    assert.ok(authUrl.includes(`state=${encodeURIComponent(state)}`));
  } finally {
    if (prevId === undefined) delete process.env.NOTION_CLIENT_ID;
    else process.env.NOTION_CLIENT_ID = prevId;
    if (prevSecret === undefined) delete process.env.NOTION_CLIENT_SECRET;
    else process.env.NOTION_CLIENT_SECRET = prevSecret;
  }
});

test('filterAndRankAccessiblePages excludes archived, database rows, and ranks workspace pages above People', () => {
  const rawPages = [
    {
      object: 'page',
      id: 'archived-1',
      archived: true,
      parent: { type: 'workspace', workspace: true },
      properties: { title: { type: 'title', title: [{ plain_text: 'Old Page' }] } },
      url: 'https://notion.so/archived-1',
    },
    {
      object: 'page',
      id: 'db-row-1',
      archived: false,
      parent: { type: 'database_id', database_id: 'db-1' },
      properties: { Prospect: { type: 'title', title: [{ plain_text: 'Dr Kerry Ryan' }] } },
      url: 'https://notion.so/db-row-1',
    },
    {
      object: 'page',
      id: 'existing-hub-1',
      archived: false,
      parent: { type: 'page_id', page_id: 'parent-1' },
      properties: {
        title: {
          type: 'title',
          title: [{ plain_text: 'Maya Awards — Intelligence & Outreach Hub' }],
        },
      },
      url: 'https://notion.so/existing-hub-1',
    },
    {
      object: 'page',
      id: 'people-sys',
      archived: false,
      parent: { type: 'workspace', workspace: true },
      properties: { title: { type: 'title', title: [{ plain_text: 'People' }] } },
      url: 'https://notion.so/people-sys',
    },
    {
      object: 'page',
      id: 'top-workspace-page',
      archived: false,
      parent: { type: 'workspace', workspace: true },
      properties: { title: { type: 'title', title: [{ plain_text: 'Marcom Campaigns' }] } },
      url: 'https://notion.so/top-workspace-page',
    },
  ];

  const ranked = filterAndRankAccessiblePages(rawPages);
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0]!.id, 'top-workspace-page');
  assert.equal(ranked[1]!.id, 'people-sys');
});

test('buildCampaignBriefBlocks structures objectives, pipeline stats, metrics and target toggles', () => {
  const brief = mockBrief();
  const blocks = buildCampaignBriefBlocks(brief, {
    totalProspects: 14,
    shortlistedCount: 8,
    draftsReadyCount: 8,
    syncedAtIso: '2026-11-05T15:00:00Z',
  });

  assert.ok(blocks.length >= 5);
  const calloutBlock = blocks.find((b) => b.type === 'callout');
  assert.ok(calloutBlock);
  assert.ok(
    calloutBlock.callout.rich_text[0].text.content.includes('Drive 2,000+ submissions'),
  );
  assert.ok(
    calloutBlock.callout.rich_text[0].text.content.includes('14 researched prospects'),
  );
});

test('buildProspectsDatabaseSchema contains all required review, verification, and outreach columns', () => {
  const schema = buildProspectsDatabaseSchema('parent-page-123');
  assert.equal(schema.parent.page_id, 'parent-page-123');
  assert.ok(schema.properties.Prospect);
  assert.ok(schema.properties['Qualification Rating']);
  assert.ok(schema.properties['Fit Score']);
  assert.ok(schema.properties.Verification);
  assert.ok(schema.properties['Review Status']);
  assert.ok(schema.properties['Outreach Status']);
  assert.ok(schema.properties['Target Segment']);
  assert.ok(schema.properties['Best Channel']);
  assert.ok(schema.properties.Email.email !== undefined);
  assert.ok(schema.properties.Phone.phone_number !== undefined);
  assert.ok(schema.properties.LinkedIn.url !== undefined);
  assert.ok(schema.properties.Website.url !== undefined);
  assert.ok(schema.properties['Top Subject Line']);
  assert.ok(schema.properties['Primary Email Draft']);
  assert.ok(schema.properties['LinkedIn / DM Draft']);
  assert.ok(schema.properties['Record ID']);
});

test('buildProspectPageProperties formats Notion API 2022-06-28 typed objects (never bare strings)', () => {
  assert.equal(normalizeEmail('mailto:kerry@example.com'), 'kerry@example.com');
  assert.equal(normalizeHttpUrl('kerryryan.co.uk'), 'https://kerryryan.co.uk/');
  assert.equal(sanitizeSelectOption('Authors, Poets & Writers'), 'Authors · Poets & Writers');

  const entry = mockResearchEntry();
  const draft = mockPersonalization();
  const props = buildProspectPageProperties(entry, draft);

  assert.equal(props.Prospect.title[0].text.content, 'Dr Kerry Ryan');
  assert.equal(props['Qualification Rating'].select.name, 'Strong Fit');
  assert.deepEqual(props['Fit Score'], { number: 88 });
  assert.equal(props['Review Status'].select.name, 'Personalized');
  assert.equal(props['Outreach Status'].select.name, 'Approved');
  assert.equal(props['Target Segment'].select.name, 'Authors · Poets & Writers');
  assert.equal(props['Best Channel'].select.name, 'Email');

  // Critical regression checks for Notion 400 validation bug:
  assert.deepEqual(props.Email, { email: 'kerry@example.com' });
  assert.deepEqual(props.Phone, { phone_number: '+44 20 7946 0958' });
  assert.deepEqual(props.LinkedIn, { url: 'https://www.linkedin.com/in/kerry-ryan-poet' });
  assert.deepEqual(props.Website, { url: 'https://kerryryan.co.uk/' });
  assert.deepEqual(props.Sources, { number: 1 });
  assert.equal(props['Record ID'].rich_text[0].text.content, 'rec-test-1');
  assert.equal(
    props['Top Subject Line'].rich_text[0].text.content,
    'Maya Poetry Book Awards — Note on The Good Other',
  );
  assert.ok(props['Primary Email Draft'].rich_text[0].text.content.includes('Dear Dr. Ryan'));
  assert.ok(props['LinkedIn / DM Draft'].rich_text[0].text.content.includes('Hi Kerry'));
});

test('buildProspectPageBodyBlocks places personalized outreach at the top and splits long copy', () => {
  const entry = mockResearchEntry();
  const draft = mockPersonalization(true);
  const blocks = buildProspectPageBodyBlocks(entry, draft);

  const summaryCallout = blocks[0];
  assert.equal(summaryCallout.type, 'callout');
  assert.ok(summaryCallout.callout.rich_text[0].text.content.includes('Verification Status'));
  assert.ok(summaryCallout.callout.rich_text[0].text.content.includes('Priority poet'));

  // Outreach Strategy & Drafts heading appears immediately as block[1] for instant visibility
  assert.equal(blocks[1].type, 'heading_2');
  assert.ok(
    blocks[1].heading_2.rich_text[0].text.content.includes('Personalized Outreach Strategy'),
  );

  // Long email (>2,000 chars) is split across multiple quote blocks without exceeding Notion's 2,000-char limit
  const quoteBlocks = blocks.filter((b) => b.type === 'quote');
  assert.ok(quoteBlocks.length >= 2);
  for (const qb of quoteBlocks) {
    assert.ok(qb.quote.rich_text[0].text.content.length <= 1950);
  }

  const chunks = splitTextChunks('A'.repeat(4100), 1850);
  assert.equal(chunks.length, 3);
});

test('syncProjectToNotion creates hub + rows on initial sync and upserts without duplicates on re-sync', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'marcom-notion-test-'));
  const prevStoreDir = process.env.MARCOM_NOTION_STORE_DIR;
  const originalFetch = globalThis.fetch;

  const calls: Array<{ method: string; url: string; body?: any }> = [];
  let createdPageCounter = 0;

  process.env.MARCOM_NOTION_STORE_DIR = tempDir;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method || 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });

    if (url.endsWith('/search') && method === 'POST') {
      if (body?.query) {
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          results: [
            {
              object: 'page',
              id: 'parent-ws-page',
              archived: false,
              parent: { type: 'workspace', workspace: true },
              properties: { title: { type: 'title', title: [{ plain_text: 'Workspace Root' }] } },
              url: 'https://notion.so/parent-ws-page',
            },
          ],
        }),
        { status: 200 },
      );
    }

    if (url.endsWith('/pages') && method === 'POST') {
      createdPageCounter += 1;
      // Validate Notion API property shapes strictly in mock!
      if (body?.parent?.database_id) {
        const p = body.properties;
        if (typeof p.Email === 'string' || typeof p.Website === 'string' || typeof p.LinkedIn === 'string') {
          return new Response(
            JSON.stringify({ code: 'validation_error', message: 'Property must be an object, not a string' }),
            { status: 400 },
          );
        }
      }
      const id = body?.parent?.database_id ? `prospect-page-${createdPageCounter}` : 'hub-page-1';
      return new Response(
        JSON.stringify({ id, url: `https://notion.so/${id}` }),
        { status: 200 },
      );
    }

    if (url.endsWith('/databases') && method === 'POST') {
      return new Response(
        JSON.stringify({ id: 'db-1', url: 'https://notion.so/db-1' }),
        { status: 200 },
      );
    }

    if (url.includes('/pages/hub-page-1') && method === 'GET') {
      return new Response(
        JSON.stringify({ id: 'hub-page-1', url: 'https://notion.so/hub-page-1', archived: false, in_trash: false }),
        { status: 200 },
      );
    }

    if (url.includes('/databases/db-1') && method === 'GET') {
      return new Response(
        JSON.stringify({
          id: 'db-1',
          url: 'https://notion.so/db-1',
          archived: false,
          in_trash: false,
          properties: buildProspectsDatabaseSchema('hub-page-1').properties,
        }),
        { status: 200 },
      );
    }

    if (url.includes('/databases/db-1/query') && method === 'POST') {
      return new Response(
        JSON.stringify({
          results: [
            {
              id: 'prospect-page-2',
              url: 'https://notion.so/prospect-page-2',
              archived: false,
              properties: {
                Prospect: { title: [{ plain_text: 'Dr Kerry Ryan' }] },
                'Record ID': { rich_text: [{ plain_text: 'rec-test-1' }] },
              },
            },
          ],
          has_more: false,
        }),
        { status: 200 },
      );
    }

    if (url.includes('/blocks/') && url.includes('/children') && method === 'GET') {
      return new Response(
        JSON.stringify({
          results: [{ id: 'callout-blk-1', type: 'callout', archived: false }],
          has_more: false,
        }),
        { status: 200 },
      );
    }

    return new Response(
      JSON.stringify({ id: 'ok', url: 'https://notion.so/ok' }),
      { status: 200 },
    );
  }) as typeof fetch;

  try {
    const brief = mockBrief();
    const p1 = mockResearchEntry('rec-test-1', 'Dr Kerry Ryan');
    const draft1 = mockPersonalization();

    // 1. Initial sync
    const firstResult = await syncProjectToNotion(
      {
        projectId: 'proj-sync-test',
        brief,
        prospects: [p1],
        drafts: { 'rec-test-1': draft1 },
        notionWorkspaceId: 'ws-1',
      },
      'ntn_test_token',
    );

    assert.equal(firstResult.success, true);
    assert.equal(firstResult.isResync, false);
    assert.equal(firstResult.syncedCount, 1);
    assert.equal(firstResult.createdCount, 1);
    assert.equal(firstResult.updatedCount, 0);
    assert.equal(firstResult.url, 'https://notion.so/hub-page-1');

    const savedState = await getProjectNotionSync('proj-sync-test');
    assert.ok(savedState);
    assert.equal(savedState.databaseId, 'db-1');
    assert.equal(savedState.prospectPageIds['rec-test-1'], 'prospect-page-2');

    // 2. Re-sync with 1 existing prospect + 1 brand-new prospect
    const p2 = mockResearchEntry('rec-test-2', 'Prof Simon Armitage');
    const secondResult = await syncProjectToNotion(
      {
        projectId: 'proj-sync-test',
        brief,
        prospects: [p1, p2],
        drafts: { 'rec-test-1': draft1 },
        notionWorkspaceId: 'ws-1',
      },
      'ntn_test_token',
    );

    assert.equal(secondResult.success, true);
    assert.equal(secondResult.isResync, true);
    assert.equal(secondResult.syncedCount, 2);
    assert.equal(secondResult.updatedCount, 1);
    assert.equal(secondResult.createdCount, 1);

    // Ensure only ONE database was ever created across both syncs
    const dbCreateCalls = calls.filter(
      (c) => c.url.endsWith('/databases') && c.method === 'POST',
    );
    assert.equal(dbCreateCalls.length, 1);

    // 3. Targeted live sync: skips unsynced projects, updates already-synced projects immediately
    await saveNotionConnection({
      accessToken: 'ntn_test_token',
      workspaceId: 'ws-1',
      workspaceName: 'Test Workspace',
      workspaceIcon: null,
      botId: 'bot-1',
      connectedAt: new Date().toISOString(),
    });

    const skippedUnsynced = await syncConnectedProjectRecordsToNotion({
      projectId: 'proj-never-synced',
      targetEntries: [p1],
      draftsByRecordId: { 'rec-test-1': draft1 },
    });
    assert.equal(skippedUnsynced.synced, false);

    const liveSynced = await syncConnectedProjectRecordsToNotion({
      projectId: 'proj-sync-test',
      brief,
      targetEntries: [p2],
      draftsByRecordId: {
        'rec-test-1': draft1,
        'rec-test-2': { ...draft1, record_id: 'rec-test-2', prospect_name: 'Prof Simon Armitage' },
      },
      allProspects: [p1, p2],
    });
    assert.equal(liveSynced.synced, true);
    assert.equal(liveSynced.updatedRecords, 1);
    assert.ok(liveSynced.prospectPageUrls?.['rec-test-2']);
  } finally {
    globalThis.fetch = originalFetch;
    if (prevStoreDir === undefined) delete process.env.MARCOM_NOTION_STORE_DIR;
    else process.env.MARCOM_NOTION_STORE_DIR = prevStoreDir;
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('Shared/hosted mode isolates Notion connections per user login session so User B never sees User A connected', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'marcom-notion-isolation-'));
  const prevStoreDir = process.env.MARCOM_NOTION_STORE_DIR;
  const prevAccessMode = process.env.APP_ACCESS_MODE;
  const prevSecret = process.env.NOTION_CLIENT_SECRET;

  process.env.MARCOM_NOTION_STORE_DIR = tempDir;
  process.env.APP_ACCESS_MODE = 'shared';
  process.env.NOTION_CLIENT_SECRET = 'secret_test_isolation_key';

  try {
    const reqUserA = new Request('https://marcom-automation.netlify.app/api/integrations/notion', {
      headers: {
        cookie: '__Host-marcom_session=session_token_user_A_12345',
      },
    });
    const reqUserB = new Request('https://marcom-automation.netlify.app/api/integrations/notion', {
      headers: {
        cookie: '__Host-marcom_session=session_token_user_B_67890',
      },
    });

    const scopeA = resolveNotionSessionScope(reqUserA);
    const scopeB = resolveNotionSessionScope(reqUserB);
    assert.notEqual(scopeA, scopeB);
    assert.ok(scopeA.startsWith('sess_'));
    assert.ok(scopeB.startsWith('sess_'));

    // User A connects Notion
    const connA = {
      accessToken: 'ntn_user_a_token',
      workspaceId: 'ws-user-a',
      workspaceName: 'User A Workspace',
      workspaceIcon: null,
      botId: 'bot-a',
      connectedAt: new Date().toISOString(),
    };
    await saveNotionConnection(connA, scopeA);

    // User A sees their connection
    const loadedForA = await getNotionConnection(reqUserA);
    assert.ok(loadedForA);
    assert.equal(loadedForA.workspaceName, 'User A Workspace');

    // User B logging into the same shared pilot app from another session MUST NOT see User A's Notion connection
    const loadedForB = await getNotionConnection(reqUserB);
    assert.equal(loadedForB, null);

    // Even if an old cookie from User A is sent with User B's session cookie, scope mismatch rejects it
    const cookieA = serializeNotionConnectionCookie(connA, scopeA);
    assert.ok(cookieA);
    const reqUserBWithStaleCookie = new Request(
      'https://marcom-automation.netlify.app/api/integrations/notion',
      {
        headers: {
          cookie: `__Host-marcom_session=session_token_user_B_67890; ${cookieA.split(';')[0]}`,
        },
      },
    );
    const loadedForBStale = await getNotionConnection(reqUserBWithStaleCookie);
    assert.equal(loadedForBStale, null);

    // Disconnecting User A clears only User A
    await disconnectNotion(reqUserA);
    assert.equal(await getNotionConnection(reqUserA), null);
  } finally {
    if (prevStoreDir === undefined) delete process.env.MARCOM_NOTION_STORE_DIR;
    else process.env.MARCOM_NOTION_STORE_DIR = prevStoreDir;
    if (prevAccessMode === undefined) delete process.env.APP_ACCESS_MODE;
    else process.env.APP_ACCESS_MODE = prevAccessMode;
    if (prevSecret === undefined) delete process.env.NOTION_CLIENT_SECRET;
    else process.env.NOTION_CLIENT_SECRET = prevSecret;
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('Two-way Notion sync pulls newer Notion draft/status edits, updates blocks in-place without deleting comments, and marks deleted prospects', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'marcom-notion-twoway-'));
  const prevStoreDir = process.env.MARCOM_NOTION_STORE_DIR;
  const originalFetch = globalThis.fetch;

  process.env.MARCOM_NOTION_STORE_DIR = tempDir;

  const brief = mockBrief();
  const p1 = mockResearchEntry('rec-test-1', 'Dr Kerry Ryan');
  const draft1 = mockPersonalization();
  const initialBlocks = buildProspectPageBodyBlocks(p1, draft1);

  let simulatedNotionEmailText = draft1.copy!.email_body;
  let simulatedNotionOutreachStatus = 'Approved';
  let simulatedNotionEditIso = '2026-10-29T14:00:00Z';
  const calls: Array<{ method: string; url: string; body?: any }> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method || 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });

    if (url.includes('/pages/hub-page-1') && method === 'GET') {
      return new Response(
        JSON.stringify({ id: 'hub-page-1', url: 'https://notion.so/hub-page-1', archived: false, in_trash: false }),
        { status: 200 },
      );
    }

    if (url.includes('/databases/db-1') && method === 'GET') {
      return new Response(
        JSON.stringify({
          id: 'db-1',
          url: 'https://notion.so/db-1',
          archived: false,
          in_trash: false,
          properties: buildProspectsDatabaseSchema('hub-page-1').properties,
        }),
        { status: 200 },
      );
    }

    if (url.includes('/databases/db-1/query') && method === 'POST') {
      return new Response(
        JSON.stringify({
          results: [
            {
              id: 'prospect-page-1',
              url: 'https://notion.so/prospect-page-1',
              archived: false,
              last_edited_time: simulatedNotionEditIso,
              properties: {
                Prospect: { title: [{ plain_text: 'Dr Kerry Ryan' }] },
                'Record ID': { rich_text: [{ plain_text: 'rec-test-1' }] },
                'Review Status': { select: { name: 'Personalized' } },
                'Outreach Status': { select: { name: simulatedNotionOutreachStatus } },
                'Top Subject Line': {
                  rich_text: [{ plain_text: 'Maya Poetry Book Awards — Note on The Good Other' }],
                },
                'Primary Email Draft': {
                  rich_text: [{ plain_text: simulatedNotionEmailText }],
                },
              },
            },
          ],
          has_more: false,
        }),
        { status: 200 },
      );
    }

    if (url.includes('/blocks/prospect-page-1/children') && method === 'GET') {
      const results = initialBlocks.map((b, idx) => {
        if (b.type === 'quote' && idx === 7) {
          return {
            ...b,
            id: `blk-${idx}`,
            last_edited_time: simulatedNotionEditIso,
            quote: { rich_text: [{ plain_text: simulatedNotionEmailText }] },
          };
        }
        return {
          ...b,
          id: `blk-${idx}`,
          last_edited_time: simulatedNotionEditIso,
        };
      });
      return new Response(JSON.stringify({ results, has_more: false }), { status: 200 });
    }

    if (url.includes('/blocks/') && url.includes('/children') && method === 'GET') {
      return new Response(
        JSON.stringify({
          results: [{ id: 'callout-blk-1', type: 'callout', archived: false }],
          has_more: false,
        }),
        { status: 200 },
      );
    }

    return new Response(JSON.stringify({ id: 'ok', url: 'https://notion.so/ok' }), { status: 200 });
  }) as typeof fetch;

  try {
    await saveNotionConnection({
      accessToken: 'ntn_test_token',
      workspaceId: 'ws-1',
      workspaceName: 'Test Workspace',
      workspaceIcon: null,
      botId: 'bot-1',
      connectedAt: new Date().toISOString(),
    });

    // Case 1: Human edits the email draft & status in Notion AFTER Marcom's updated_at (2026-10-29T14:30:00Z)
    simulatedNotionEmailText = 'Dear Dr. Ryan,\n\n[Edited directly in Notion by reviewer]';
    simulatedNotionOutreachStatus = 'Needs Revision';
    simulatedNotionEditIso = '2026-10-29T16:00:00Z';

    const pullResult = await syncProjectToNotion(
      {
        projectId: 'proj-twoway',
        brief,
        prospects: [p1],
        drafts: { 'rec-test-1': draft1 },
        notionWorkspaceId: 'ws-1',
        existingSync: {
          projectId: 'proj-twoway',
          notionWorkspaceId: 'ws-1',
          parentPageId: 'parent-1',
          campaignPageId: 'hub-page-1',
          campaignPageUrl: 'https://notion.so/hub-page-1',
          databaseId: 'db-1',
          databaseUrl: 'https://notion.so/db-1',
          prospectPageIds: { 'rec-test-1': 'prospect-page-1' },
          syncedCount: 1,
          lastSyncedAt: '2026-10-29T15:00:00Z',
        },
      },
      'ntn_test_token',
    );

    assert.equal(pullResult.success, true);
    assert.ok(pullResult.reconciledChanges);
    assert.equal(pullResult.reconciledChanges.updatedDrafts.length, 1);
    assert.equal(
      pullResult.reconciledChanges.updatedDrafts[0]!.copy?.email_body,
      'Dear Dr. Ryan,\n\n[Edited directly in Notion by reviewer]',
    );
    assert.equal(pullResult.reconciledChanges.updatedDrafts[0]!.status, 'needs_more_research');
    assert.equal(pullResult.reconciledChanges.updatedDrafts[0]!.edited_by_human, true);

    // Ensure the email quote block (blk-7) was NOT deleted (preserving inline comments!)
    const deletedQuoteBlock = calls.find(
      (c) => c.method === 'DELETE' && c.url.endsWith('/blocks/blk-7'),
    );
    assert.equal(deletedQuoteBlock, undefined);

    // Case 2: Marcom regenerates the draft AFTER the Notion edit (2026-10-29T17:00:00Z)
    calls.length = 0;
    const regeneratedDraft: PersonalizationEntry = {
      ...draft1,
      updated_at: '2026-10-29T17:00:00Z',
      copy: {
        ...draft1.copy!,
        email_body: 'Dear Dr. Ryan,\n\n[Freshly regenerated in Marcom v2]',
      },
    };

    const pushResult = await syncProjectToNotion(
      {
        projectId: 'proj-twoway',
        brief,
        prospects: [p1],
        drafts: { 'rec-test-1': regeneratedDraft },
        notionWorkspaceId: 'ws-1',
        existingSync: {
          projectId: 'proj-twoway',
          notionWorkspaceId: 'ws-1',
          parentPageId: 'parent-1',
          campaignPageId: 'hub-page-1',
          campaignPageUrl: 'https://notion.so/hub-page-1',
          databaseId: 'db-1',
          databaseUrl: 'https://notion.so/db-1',
          prospectPageIds: { 'rec-test-1': 'prospect-page-1' },
          syncedCount: 1,
          lastSyncedAt: '2026-10-29T16:05:00Z',
        },
      },
      'ntn_test_token',
    );

    assert.equal(pushResult.success, true);
    // Verify blk-7 (email quote block) was updated IN-PLACE via PATCH /blocks/blk-7, not deleted!
    const patchedQuoteCall = calls.find(
      (c) => c.method === 'PATCH' && c.url.endsWith('/blocks/blk-7'),
    );
    assert.ok(patchedQuoteCall);
    assert.equal(
      patchedQuoteCall.body.quote.rich_text[0].text.content,
      'Dear Dr. Ryan,\n\n[Freshly regenerated in Marcom v2]',
    );

    // Case 3: Deleting the prospect in Marcom marks the Notion page as "Removed in Marcom"
    calls.length = 0;
    await markDeletedProjectRecordsInNotion({
      projectId: 'proj-twoway',
      deletedRecordIds: ['rec-test-1'],
    });
    const removedPagePatch = calls.find(
      (c) => c.method === 'PATCH' && c.url.endsWith('/pages/prospect-page-1'),
    );
    assert.ok(removedPagePatch);
    assert.equal(
      removedPagePatch.body.properties['Review Status'].select.name,
      'Removed in Marcom',
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (prevStoreDir === undefined) delete process.env.MARCOM_NOTION_STORE_DIR;
    else process.env.MARCOM_NOTION_STORE_DIR = prevStoreDir;
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('Campaign Hub config edits (e.g. target 2000 -> 3000), Prospect research edits, and page refresh pull sync cleanly while making 0 block DELETEs', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'marcom-notion-hub-research-'));
  const prevStoreDir = process.env.MARCOM_NOTION_STORE_DIR;
  const originalFetch = globalThis.fetch;

  process.env.MARCOM_NOTION_STORE_DIR = tempDir;

  const brief = mockBrief();
  brief.project.primary_objective = 'Identify 2000 poetry prize judges and literary curators';
  brief.project.description = 'Outreach campaign targeting 2000 qualified prospects across the UK.';
  brief.targets[0]!.description = 'Reach 2000 UK literary scholars and creative writing lecturers.';

  const p1 = mockResearchEntry('rec-test-1', 'Dr Kerry Ryan');
  const draft1 = mockPersonalization();
  const initialProspectBlocks = buildProspectPageBodyBlocks(p1, draft1);

  const calls: Array<{ method: string; url: string; body?: any }> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method || 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });

    if (url.includes('/pages/hub-page-1') && method === 'GET') {
      return new Response(
        JSON.stringify({
          id: 'hub-page-1',
          url: 'https://notion.so/hub-page-1',
          archived: false,
          in_trash: false,
          last_edited_time: '2026-10-29T16:30:00Z',
          properties: {
            title: {
              type: 'title',
              title: [{ plain_text: 'Maya Poetry Book Awards — Intelligence & Outreach Hub' }],
            },
          },
        }),
        { status: 200 },
      );
    }

    if (url.includes('/databases/db-1') && method === 'GET') {
      return new Response(
        JSON.stringify({
          id: 'db-1',
          url: 'https://notion.so/db-1',
          archived: false,
          in_trash: false,
          properties: buildProspectsDatabaseSchema('hub-page-1').properties,
        }),
        { status: 200 },
      );
    }

    if (url.includes('/blocks/hub-page-1/children') && method === 'GET') {
      return new Response(
        JSON.stringify({
          results: [
            {
              id: 'hub-callout-1',
              type: 'callout',
              last_edited_time: '2026-10-29T16:30:00Z',
              callout: {
                rich_text: [
                  {
                    plain_text:
                      'Primary Objective: Identify 2000 poetry prize judges and literary curators\nPipeline Snapshot: 1 researched prospects · 1 shortlisted · 1 personalized outreach drafts ready · Synced 2026-10-29 15:00 UTC',
                  },
                ],
              },
            },
            {
              id: 'hub-desc-1',
              type: 'paragraph',
              last_edited_time: '2026-10-29T16:30:00Z',
              paragraph: {
                rich_text: [
                  {
                    plain_text:
                      'Outreach campaign targeting 2000 qualified prospects across the UK.',
                  },
                ],
              },
            },
            {
              id: 'hub-target-toggle-1',
              type: 'toggle',
              last_edited_time: '2026-10-29T16:30:00Z',
              toggle: {
                rich_text: [
                  {
                    plain_text:
                      'Target Group: Poetry Award Judges (person) — Priority: PRIMARY',
                  },
                ],
              },
            },
          ],
          has_more: false,
        }),
        { status: 200 },
      );
    }

    if (url.includes('/blocks/hub-target-toggle-1/children') && method === 'GET') {
      // User updated target audience from 2000 to 3000 inside the Target Group toggle in Notion!
      return new Response(
        JSON.stringify({
          results: [
            {
              id: 'target-desc-child-1',
              type: 'paragraph',
              last_edited_time: '2026-10-29T16:30:00Z',
              paragraph: {
                rich_text: [
                  {
                    plain_text:
                      'Target Description: Reach 3000 UK literary scholars and creative writing lecturers.',
                  },
                ],
              },
            },
          ],
          has_more: false,
        }),
        { status: 200 },
      );
    }

    if (url.includes('/databases/db-1/query') && method === 'POST') {
      return new Response(
        JSON.stringify({
          results: [
            {
              id: 'prospect-page-1',
              url: 'https://notion.so/prospect-page-1',
              archived: false,
              last_edited_time: '2026-10-29T16:30:00Z',
              properties: {
                Prospect: { title: [{ plain_text: 'Dr Kerry Ryan-Updated' }] },
                'Record ID': { rich_text: [{ plain_text: 'rec-test-1' }] },
                'Role / Title': { rich_text: [{ plain_text: 'Professor of Creative Writing' }] },
                Organisation: { rich_text: [{ plain_text: 'Oxford Brookes University' }] },
                Email: { email: 'k.ryan@brookes.ac.uk' },
                'Fit Score': { number: 96 },
                'Review Status': { select: { name: 'Personalized' } },
                'Outreach Status': { select: { name: 'Draft Ready' } },
                'Top Subject Line': {
                  rich_text: [{ plain_text: draft1.copy!.subject_lines[0]!.text }],
                },
                'Primary Email Draft': {
                  rich_text: [{ plain_text: draft1.copy!.email_body }],
                },
              },
            },
          ],
          has_more: false,
        }),
        { status: 200 },
      );
    }

    if (url.includes('/blocks/prospect-page-1/children') && method === 'GET') {
      const results = initialProspectBlocks.map((b, idx) => ({
        ...b,
        id: `p-blk-${idx}`,
        last_edited_time: '2026-10-29T15:00:00Z',
      }));
      return new Response(JSON.stringify({ results, has_more: false }), { status: 200 });
    }

    return new Response(JSON.stringify({ id: 'ok', url: 'https://notion.so/ok' }), { status: 200 });
  }) as typeof fetch;

  try {
    const syncState = {
      projectId: 'proj-hub-sync',
      notionWorkspaceId: 'ws-1',
      parentPageId: 'parent-1',
      campaignPageId: 'hub-page-1',
      campaignPageUrl: 'https://notion.so/hub-page-1',
      databaseId: 'db-1',
      databaseUrl: 'https://notion.so/db-1',
      prospectPageIds: { 'rec-test-1': 'prospect-page-1' },
      syncedCount: 1,
      lastSyncedAt: '2026-10-29T15:00:00Z',
    };

    // 1. Page Refresh pull (`pullNotionChangesForProject`) pulls both Campaign Hub (2000 -> 3000) and Prospect edits
    const pulled = await pullNotionChangesForProject(
      {
        projectId: 'proj-hub-sync',
        brief,
        configurationUpdatedAt: '2026-10-29T14:00:00Z',
        prospects: [p1],
        drafts: { 'rec-test-1': draft1 },
        existingSync: syncState,
      },
      'ntn_test_token',
    );

    assert.ok(pulled.pulledCount >= 2);
    assert.ok(pulled.updatedBrief);
    assert.ok(pulled.updatedBrief.targets[0]!.description.includes('3000'));
    assert.ok(pulled.updatedBrief.project.primary_objective.includes('3000'));
    assert.ok(pulled.updatedBrief.project.description.includes('3000'));

    assert.equal(pulled.updatedResearchEntries?.length, 1);
    const updatedProspect = pulled.updatedResearchEntries![0]!;
    assert.equal(updatedProspect.record.identity.name, 'Dr Kerry Ryan-Updated');
    assert.equal(updatedProspect.record.role, 'Professor of Creative Writing');
    assert.equal(updatedProspect.record.organisation, 'Oxford Brookes University');
    assert.equal(updatedProspect.record.fit.score, 96);
    assert.equal(updatedProspect.record.public_contact[0]?.value, 'k.ryan@brookes.ac.uk');

    // 2. Full Re-sync (`syncProjectToNotion`) preserves 100% of Notion blocks (0 DELETE calls and 0 outreach PATCH calls)
    calls.length = 0;
    const fullSync = await syncProjectToNotion(
      {
        projectId: 'proj-hub-sync',
        brief,
        configurationUpdatedAt: '2026-10-29T14:00:00Z',
        prospects: [p1],
        drafts: { 'rec-test-1': draft1 },
        notionWorkspaceId: 'ws-1',
        existingSync: syncState,
      },
      'ntn_test_token',
    );

    assert.equal(fullSync.success, true);
    const deleteCalls = calls.filter((c) => c.method === 'DELETE');
    assert.equal(deleteCalls.length, 0, 'Must never call DELETE on content blocks');

    const outreachBlockPatches = calls.filter(
      (c) => c.method === 'PATCH' && c.url.includes('/blocks/p-blk-'),
    );
    assert.equal(
      outreachBlockPatches.length,
      0,
      'Must not PATCH prospect blocks when draft was not changed in Marcom, preserving inline comment anchors',
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (prevStoreDir === undefined) delete process.env.MARCOM_NOTION_STORE_DIR;
    else process.env.MARCOM_NOTION_STORE_DIR = prevStoreDir;
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('Campaign collaboration: Collaborator B in a separate browser session can sync Sent status on a campaign synced by Collaborator A without exposing global integrations', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'marcom-notion-collab-'));
  const prevStoreDir = process.env.MARCOM_NOTION_STORE_DIR;
  const prevAccessMode = process.env.APP_ACCESS_MODE;
  const originalFetch = globalThis.fetch;

  process.env.MARCOM_NOTION_STORE_DIR = tempDir;
  process.env.APP_ACCESS_MODE = 'shared';

  const brief = mockBrief();
  const p1 = mockResearchEntry('rec-collab-1', 'Dr Kerry Ryan');
  const draft1 = mockPersonalization();
  const initialProspectBlocks = buildProspectPageBodyBlocks(p1, draft1);

  const calls: Array<{ method: string; url: string; body?: any }> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method || 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });

    if (url.includes('/pages/hub-collab-1') && method === 'GET') {
      return new Response(
        JSON.stringify({
          id: 'hub-collab-1',
          url: 'https://notion.so/hub-collab-1',
          archived: false,
          in_trash: false,
        }),
        { status: 200 },
      );
    }

    if (url.includes('/databases/db-collab-1') && method === 'GET') {
      return new Response(
        JSON.stringify({
          id: 'db-collab-1',
          url: 'https://notion.so/db-collab-1',
          archived: false,
          in_trash: false,
          properties: buildProspectsDatabaseSchema('hub-collab-1').properties,
        }),
        { status: 200 },
      );
    }

    if (url.includes('/databases/db-collab-1/query') && method === 'POST') {
      return new Response(
        JSON.stringify({
          results: [
            {
              id: 'prospect-collab-1',
              url: 'https://notion.so/prospect-collab-1',
              archived: false,
              last_edited_time: '2026-10-29T16:00:00Z',
              properties: {
                Prospect: { title: [{ plain_text: 'Dr Kerry Ryan' }] },
                'Record ID': { rich_text: [{ plain_text: 'rec-collab-1' }] },
                'Review Status': { select: { name: 'Sent / Contacted' } },
                'Outreach Status': { select: { name: 'Sent' } },
              },
            },
          ],
          has_more: false,
        }),
        { status: 200 },
      );
    }

    if (url.includes('/blocks/prospect-collab-1/children') && method === 'GET') {
      const results = initialProspectBlocks.map((b, idx) => ({
        ...b,
        id: `c-blk-${idx}`,
        last_edited_time: '2026-10-29T15:00:00Z',
      }));
      return new Response(JSON.stringify({ results, has_more: false }), { status: 200 });
    }

    return new Response(
      JSON.stringify({ id: 'prospect-collab-1', url: 'https://notion.so/prospect-collab-1' }),
      { status: 200 },
    );
  }) as typeof fetch;

  try {
    const reqUserA = new Request('https://marcom-automation.netlify.app/api/projects/proj-collab/notion/sync', {
      headers: { cookie: '__Host-marcom_session=session_token_user_A_collab' },
    });
    const reqUserB = new Request('https://marcom-automation.netlify.app/api/projects/proj-collab/notion/sync', {
      headers: { cookie: '__Host-marcom_session=session_token_user_B_collab' },
    });

    await saveNotionConnection(
      {
        accessToken: 'ntn_collab_token_A',
        workspaceId: 'ws-collab',
        workspaceName: 'Shared Campaign Workspace',
        workspaceIcon: null,
        botId: 'bot-collab',
        connectedAt: new Date().toISOString(),
      },
      reqUserA,
    );

    // Collaborator A syncs the campaign project to Notion
    await syncProjectToNotion(
      {
        projectId: 'proj-collab',
        brief,
        prospects: [p1],
        drafts: { 'rec-collab-1': draft1 },
        notionWorkspaceId: 'ws-collab',
        existingSync: {
          projectId: 'proj-collab',
          notionWorkspaceId: 'ws-collab',
          parentPageId: 'parent-1',
          campaignPageId: 'hub-collab-1',
          campaignPageUrl: 'https://notion.so/hub-collab-1',
          databaseId: 'db-collab-1',
          databaseUrl: 'https://notion.so/db-collab-1',
          prospectPageIds: { 'rec-collab-1': 'prospect-collab-1' },
          syncedCount: 1,
          lastSyncedAt: '2026-10-29T15:00:00Z',
        },
      },
      'ntn_collab_token_A',
    );

    // Global Notion connection remains strictly isolated: User B does not inherit User A's global Integrations connection
    assert.equal(await getNotionConnection(reqUserB), null);
    assert.equal(await getProjectNotionConnection('unsynced-other-proj', reqUserB), null);

    // However, on the synced campaign 'proj-collab', Collaborator B CAN access the project's Notion sync!
    const projectConnForB = await getProjectNotionConnection('proj-collab', reqUserB);
    assert.ok(projectConnForB);
    assert.equal(projectConnForB.accessToken, 'ntn_collab_token_A');

    // Sanitized sync record never leaks raw token to client JSON responses
    const rawSync = await getProjectNotionSync('proj-collab');
    const safeSync = sanitizeProjectSyncRecordForClient(rawSync);
    assert.ok(safeSync);
    assert.equal(safeSync.projectAccessToken, undefined);

    // Collaborator B marks the entry as Sent in Marcom (`relationship_status: 'contacted'`), which syncs to Notion via User B's request
    calls.length = 0;
    const sentEntry: ResearchEntry = {
      ...p1,
      relationship_status: 'contacted',
    };
    const targetedRes = await syncConnectedProjectRecordsToNotion({
      projectId: 'proj-collab',
      targetEntries: [sentEntry],
      draftsByRecordId: { 'rec-collab-1': draft1 },
      req: reqUserB,
    });
    assert.equal(targetedRes.synced, true);
    const pagePatch = calls.find(
      (c) => c.method === 'PATCH' && c.url.includes('/pages/prospect-collab-1'),
    );
    assert.ok(pagePatch);
    assert.equal(pagePatch.body.properties['Review Status'].select.name, 'Sent / Contacted');
    assert.equal(pagePatch.body.properties['Outreach Status'].select.name, 'Sent');

    // Conversely, if a collaborator marks 'Sent / Contacted' in Notion, pulling changes sets relationshipStatus: 'contacted' in Marcom
    const pulled = await pullNotionChangesForProject(
      {
        projectId: 'proj-collab',
        brief,
        prospects: [p1], // p1 has relationship_status: null
        drafts: { 'rec-collab-1': draft1 },
        existingSync: rawSync!,
      },
      projectConnForB.accessToken,
    );
    assert.equal(pulled.updatedReviews.length, 1);
    assert.equal(pulled.updatedReviews[0]?.recordId, 'rec-collab-1');
    assert.equal(pulled.updatedReviews[0]?.status, 'shortlisted');
    assert.equal(pulled.updatedReviews[0]?.relationshipStatus, 'contacted');
  } finally {
    globalThis.fetch = originalFetch;
    if (prevStoreDir === undefined) delete process.env.MARCOM_NOTION_STORE_DIR;
    else process.env.MARCOM_NOTION_STORE_DIR = prevStoreDir;
    if (prevAccessMode === undefined) delete process.env.APP_ACCESS_MODE;
    else process.env.APP_ACCESS_MODE = prevAccessMode;
    await rm(tempDir, { recursive: true, force: true });
  }
});
