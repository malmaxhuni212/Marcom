import type { StructuredBrief } from '@/marcom/schemas/structured-brief';
import type { ResearchEntry } from '@/marcom/schemas/research-record';
import type { PersonalizationEntry } from '@/marcom/schemas/personalization';
import type {
  NotionDatabaseRowSnapshot,
  NotionProjectSyncRecord,
  NotionReconciledChanges,
  NotionSyncOptions,
  NotionSyncResult,
} from './types';
import {
  appendNotionBlocks,
  createNotionDatabase,
  createNotionPage,
  extractBlockPlainText,
  getNotionDatabase,
  getNotionPage,
  listNotionBlockChildren,
  normalizeComparableBlockText,
  NotionApiError,
  notionFetch,
  queryNotionDatabaseRows,
  replaceNotionPageBlocks,
  searchNotionAccessiblePages,
  updateNotionBlock,
  updateNotionDatabase,
  updateNotionPage,
  type NotionBlockChild,
} from './client';
import {
  buildCampaignBriefBlocks,
  buildCampaignSummaryCallout,
  buildProspectPageBodyBlocks,
  buildProspectPageProperties,
  buildProspectsDatabaseProperties,
  buildProspectsDatabaseSchema,
  bulletItem,
  callout,
  normalizeEmail,
  normalizeHttpUrl,
  normalizePhone,
  paragraph,
  richText,
  type CampaignBriefSyncStats,
  type ProspectBodyBlockOptions,
} from './builder';
import {
  getProjectNotionConnection,
  getProjectNotionSync,
  saveProjectNotionSync,
} from './store';

export function notionPageUrlFromId(pageId: string): string {
  return `https://www.notion.so/${pageId.replace(/-/g, '')}`;
}

async function findRecoverableCampaignHub(
  accessToken: string,
  expectedHubTitle: string,
): Promise<{
  campaignPageId: string;
  campaignPageUrl: string;
  parentPageId: string;
  databaseId: string;
  databaseUrl: string;
  existingProperties: Record<string, any>;
} | null> {
  try {
    const searchData = await notionFetch('/search', accessToken, {
      method: 'POST',
      body: JSON.stringify({
        query: expectedHubTitle,
        filter: { value: 'page', property: 'object' },
        page_size: 20,
      }),
    });

    const pages: any[] = Array.isArray(searchData.results) ? searchData.results : [];
    for (const page of pages) {
      if (!page || page.archived || page.in_trash) continue;
      if (page.parent?.type === 'database_id') continue;

      const titleArr = page.properties?.title?.title || page.properties?.Name?.title;
      const titleText = Array.isArray(titleArr)
        ? titleArr.map((t: any) => t?.plain_text || '').join('').trim()
        : '';
      if (titleText !== expectedHubTitle) continue;

      const children = await listNotionBlockChildren(accessToken, page.id);
      const childDbBlock = children.find((b) => b.type === 'child_database');
      if (!childDbBlock) continue;

      const db = await getNotionDatabase(accessToken, childDbBlock.id);
      if (!db || db.archived || db.inTrash) continue;

      return {
        campaignPageId: page.id,
        campaignPageUrl: page.url,
        parentPageId: page.parent?.page_id || 'workspace',
        databaseId: db.id,
        databaseUrl: db.url,
        existingProperties: db.properties,
      };
    }
  } catch {
    // Non-fatal: if search recovery fails, fall back to creating a fresh Campaign Hub
  }
  return null;
}

async function ensureMissingDatabaseColumns(
  accessToken: string,
  databaseId: string,
  existingProperties: Record<string, any>,
): Promise<void> {
  const desired = buildProspectsDatabaseProperties();
  const missing: Record<string, any> = {};

  for (const [propName, propSchema] of Object.entries(desired)) {
    if (propName === 'Prospect') continue; // Never overwrite title column
    if (!(propName in existingProperties)) {
      missing[propName] = propSchema;
    }
  }

  if (Object.keys(missing).length > 0) {
    await updateNotionDatabase(accessToken, databaseId, { properties: missing });
  }
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  const runners = Array.from({ length: workerCount }, async () => {
    while (cursor < items.length) {
      const idx = cursor;
      cursor += 1;
      await worker(items[idx]!, idx);
    }
  });
  await Promise.all(runners);
}

interface ExtractedNotionOutreachBlocks {
  subjectLine: string | null;
  emailBody: string | null;
  linkedinMessage: string | null;
  executiveOverview: string | null;
  maxBlockEditMs: number;
}

function extractNotionOutreachFromBlocks(blocks: NotionBlockChild[]): ExtractedNotionOutreachBlocks {
  const dividerIdx = blocks.findIndex((b) => b.type === 'divider');
  const outreachBlocks = dividerIdx >= 2 ? blocks.slice(2, dividerIdx) : [];
  const dossierBlocks = dividerIdx >= 0 ? blocks.slice(dividerIdx + 1) : [];

  let currentSection: 'none' | 'subject' | 'email' | 'linkedin' = 'none';
  let subjectLine: string | null = null;
  const emailParts: string[] = [];
  const linkedinParts: string[] = [];
  let maxBlockEditMs = 0;

  for (const blk of blocks) {
    if (blk.lastEditedTime) {
      const ms = Date.parse(blk.lastEditedTime);
      if (Number.isFinite(ms) && ms > maxBlockEditMs) {
        maxBlockEditMs = ms;
      }
    }
  }

  for (const blk of outreachBlocks) {
    const text = (blk.plainText || '').trim();
    if (blk.type === 'heading_3') {
      const lower = text.toLowerCase();
      if (lower.includes('subject line')) currentSection = 'subject';
      else if (lower.includes('primary email')) currentSection = 'email';
      else if (lower.includes('linkedin') || lower.includes('direct message')) {
        currentSection = 'linkedin';
      } else {
        currentSection = 'none';
      }
      continue;
    }

    if (currentSection === 'subject' && blk.type === 'bulleted_list_item' && !subjectLine && text) {
      subjectLine = text.replace(/^\[[A-Z0-9_ -]+\]\s*/i, '').trim() || null;
    } else if (currentSection === 'email' && (blk.type === 'quote' || blk.type === 'paragraph') && text) {
      emailParts.push(text);
    } else if (currentSection === 'linkedin' && (blk.type === 'quote' || blk.type === 'paragraph') && text) {
      linkedinParts.push(text);
    }
  }

  let inExecutiveOverview = false;
  const overviewParts: string[] = [];
  for (const blk of dossierBlocks) {
    const text = (blk.plainText || '').trim();
    if (blk.type === 'heading_3') {
      if (text.toLowerCase().includes('executive overview')) {
        inExecutiveOverview = true;
      } else if (inExecutiveOverview) {
        break;
      }
      continue;
    }
    if (inExecutiveOverview && blk.type === 'paragraph' && text) {
      overviewParts.push(text);
    }
  }

  return {
    subjectLine,
    emailBody: emailParts.length ? emailParts.join('\n\n') : null,
    linkedinMessage: linkedinParts.length ? linkedinParts.join('\n\n') : null,
    executiveOverview: overviewParts.length ? overviewParts.join('\n\n') : null,
    maxBlockEditMs,
  };
}

function mapNotionReviewStatusToMarcom(
  notionReviewStatus: string | null | undefined,
): 'needs_review' | 'shortlisted' | 'rejected' | 'enrichment_requested' | null {
  if (!notionReviewStatus) return null;
  const norm = notionReviewStatus.trim().toLowerCase();
  if (norm === 'shortlisted' || norm === 'personalized' || norm === 'sent / contacted') {
    return 'shortlisted';
  }
  if (norm === 'rejected') return 'rejected';
  if (norm === 'more research needed') return 'enrichment_requested';
  if (norm === 'needs review') return 'needs_review';
  return null;
}

function mapNotionOutreachStatusToMarcom(
  notionOutreachStatus: string | null | undefined,
): PersonalizationEntry['status'] | null {
  if (!notionOutreachStatus) return null;
  const norm = notionOutreachStatus.trim().toLowerCase();
  if (norm === 'approved') return 'approved';
  if (norm === 'needs revision') return 'needs_more_research';
  if (norm === 'rejected') return 'rejected';
  if (norm === 'draft ready') return 'draft';
  return null;
}

function mapNotionQualificationRatingToBand(
  rating: string | null | undefined,
): ResearchEntry['record']['fit']['band'] | null {
  if (!rating) return null;
  const norm = rating.trim().toLowerCase();
  if (norm === 'highly relevant') return 'highly_relevant';
  if (norm === 'strong fit') return 'strong';
  if (norm === 'possible fit') return 'possible';
  if (norm === 'weak fit') return 'weak';
  if (norm === 'not relevant') return 'irrelevant';
  return null;
}

function extractNumbersFromString(str: string): string[] {
  const matches = str.match(/\b(\d{1,3}(?:,\d{3})+|\d{2,})\b/g);
  return matches ? matches.map((m) => m.replace(/,/g, '')) : [];
}

function detectNumericReplacement(
  oldText: string,
  newText: string,
): { oldRaw: string; newRaw: string } | null {
  if (!oldText || !newText || oldText === newText) return null;
  const oldNums = extractNumbersFromString(oldText);
  const newNums = extractNumbersFromString(newText);
  for (const o of oldNums) {
    if (!newNums.includes(o)) {
      const replacement = newNums.find((n) => !oldNums.includes(n));
      if (replacement) {
        return { oldRaw: o, newRaw: replacement };
      }
    }
  }
  return null;
}

function applyNumericReplacementToText(
  text: string,
  oldRaw: string,
  newRaw: string,
): string {
  if (!text || !oldRaw || !newRaw || oldRaw === newRaw) return text;
  const formattedOldWithCommas = Number(oldRaw).toLocaleString('en-US');
  let result = text.replace(new RegExp(`\\b${oldRaw}\\b`, 'g'), newRaw);
  if (formattedOldWithCommas !== oldRaw) {
    const formattedNewWithCommas = Number(newRaw).toLocaleString('en-US');
    result = result.replace(
      new RegExp(`\\b${formattedOldWithCommas.replace(/,/g, ',')}\\b`, 'g'),
      formattedNewWithCommas,
    );
  }
  return result;
}

async function reconcileCampaignHubWithBrief(options: {
  accessToken: string;
  campaignPageId: string;
  existingPageTitle?: string | null;
  existingPageLastEditedTime?: string | null;
  brief: StructuredBrief;
  syncStats: CampaignBriefSyncStats;
  configurationUpdatedAt?: string | null;
  lastSyncedAt?: string | null;
  pushUpdatesToNotion: boolean;
}): Promise<{
  brief: StructuredBrief;
  updatedInMarcom: boolean;
}> {
  const {
    accessToken,
    campaignPageId,
    existingPageTitle,
    existingPageLastEditedTime,
    brief,
    syncStats,
    configurationUpdatedAt,
    lastSyncedAt,
    pushUpdatesToNotion,
  } = options;

  let workingBrief: StructuredBrief = JSON.parse(JSON.stringify(brief)) as StructuredBrief;
  let updatedInMarcom = false;

  const topBlocks = await listNotionBlockChildren(accessToken, campaignPageId).catch(
    () => [] as NotionBlockChild[],
  );
  if (topBlocks.length === 0) {
    return { brief: workingBrief, updatedInMarcom: false };
  }

  const summaryCalloutBlk = topBlocks.find((b) => b.type === 'callout');
  const firstCalloutIdx = summaryCalloutBlk ? topBlocks.indexOf(summaryCalloutBlk) : -1;
  const firstStructuralIdx = topBlocks.findIndex(
    (b, idx) =>
      idx > firstCalloutIdx &&
      (b.type === 'toggle' || b.type === 'heading_2' || b.type === 'divider'),
  );
  const descriptionBlocks =
    firstCalloutIdx >= 0
      ? topBlocks
          .slice(
            firstCalloutIdx + 1,
            firstStructuralIdx === -1 ? topBlocks.length : firstStructuralIdx,
          )
          .filter(
            (b) =>
              b.type === 'paragraph' &&
              !(b.plainText || '').startsWith('Scroll right in the table'),
          )
      : [];

  const secondaryObjToggle = topBlocks.find(
    (b) => b.type === 'toggle' && (b.plainText || '').startsWith('Secondary Objectives'),
  );
  const successMetricsToggle = topBlocks.find(
    (b) => b.type === 'toggle' && (b.plainText || '').startsWith('Success Metrics'),
  );
  const guardrailsToggle = topBlocks.find(
    (b) => b.type === 'toggle' && (b.plainText || '').toLowerCase().includes('guardrails'),
  );
  const targetGroupToggles = topBlocks.filter(
    (b) => b.type === 'toggle' && (b.plainText || '').startsWith('Target Group:'),
  );

  const [
    secondaryObjChildren,
    successMetricsChildren,
    guardrailsChildren,
    ...targetGroupChildrenList
  ] = await Promise.all([
    secondaryObjToggle
      ? listNotionBlockChildren(accessToken, secondaryObjToggle.id).catch(() => [])
      : Promise.resolve([] as NotionBlockChild[]),
    successMetricsToggle
      ? listNotionBlockChildren(accessToken, successMetricsToggle.id).catch(() => [])
      : Promise.resolve([] as NotionBlockChild[]),
    guardrailsToggle
      ? listNotionBlockChildren(accessToken, guardrailsToggle.id).catch(() => [])
      : Promise.resolve([] as NotionBlockChild[]),
    ...targetGroupToggles.map((t) =>
      listNotionBlockChildren(accessToken, t.id).catch(() => [] as NotionBlockChild[]),
    ),
  ]);

  let maxHubNotionEditMs = 0;
  if (existingPageLastEditedTime) {
    const pMs = Date.parse(existingPageLastEditedTime);
    if (Number.isFinite(pMs) && pMs > maxHubNotionEditMs) maxHubNotionEditMs = pMs;
  }
  for (const b of topBlocks) {
    if (b.lastEditedTime) {
      const bMs = Date.parse(b.lastEditedTime);
      if (Number.isFinite(bMs) && bMs > maxHubNotionEditMs) maxHubNotionEditMs = bMs;
    }
  }
  for (const b of [
    ...secondaryObjChildren,
    ...successMetricsChildren,
    ...guardrailsChildren,
    ...targetGroupChildrenList.flat(),
  ]) {
    if (b.lastEditedTime) {
      const bMs = Date.parse(b.lastEditedTime);
      if (Number.isFinite(bMs) && bMs > maxHubNotionEditMs) maxHubNotionEditMs = bMs;
    }
  }

  const marcomConfigMs = configurationUpdatedAt ? Date.parse(configurationUpdatedAt) : 0;
  const lastSyncedMs = lastSyncedAt ? Date.parse(lastSyncedAt) : 0;
  const isMarcomBriefEditedSinceSync =
    lastSyncedMs > 0 &&
    marcomConfigMs > lastSyncedMs + 2000 &&
    marcomConfigMs > maxHubNotionEditMs;

  if (!isMarcomBriefEditedSinceSync) {
    let detectedNumChange: { oldRaw: string; newRaw: string } | null = null;

    // 1. Check Campaign Title
    if (existingPageTitle && existingPageTitle !== 'Untitled Page') {
      const strippedTitle = existingPageTitle
        .replace(/\s*—\s*Intelligence\s*&\s*Outreach\s*Hub$/i, '')
        .replace(/\s*—\s*Campaign\s*Hub$/i, '')
        .trim();
      if (strippedTitle && strippedTitle !== (workingBrief.project.name || '').trim()) {
        workingBrief.project.name = strippedTitle;
        updatedInMarcom = true;
      }
    }

    // 2. Check Primary Objective from top callout
    if (summaryCalloutBlk?.plainText) {
      const calloutLines = summaryCalloutBlk.plainText
        .split('\n')
        .map((l) => l.trim())
        .filter(
          (l) =>
            Boolean(l) &&
            !l.startsWith('Pipeline Snapshot:') &&
            !l.startsWith('🔄'),
        );
      if (calloutLines.length > 0) {
        const rawCallout = calloutLines.join(' ');
        const notionObjective = rawCallout.replace(/^Primary Objective:\s*/i, '').trim();
        const currentObjective = (
          workingBrief.project.primary_objective ||
          workingBrief.project.description ||
          ''
        ).trim();
        if (notionObjective && notionObjective !== currentObjective) {
          detectedNumChange =
            detectedNumChange || detectNumericReplacement(currentObjective, notionObjective);
          const wasDescSameAsObj =
            !workingBrief.project.description ||
            workingBrief.project.description.trim() === currentObjective;
          workingBrief.project.primary_objective = notionObjective;
          if (wasDescSameAsObj || descriptionBlocks.length === 0) {
            workingBrief.project.description = notionObjective;
          }
          updatedInMarcom = true;
        }
      }
    }

    // 3. Check Description paragraph
    if (descriptionBlocks.length > 0) {
      const notionDesc = descriptionBlocks
        .map((b) => (b.plainText || '').trim())
        .filter(Boolean)
        .join('\n\n');
      const currentDesc = (workingBrief.project.description || '').trim();
      if (notionDesc && notionDesc !== currentDesc) {
        detectedNumChange =
          detectedNumChange || detectNumericReplacement(currentDesc, notionDesc);
        workingBrief.project.description = notionDesc;
        updatedInMarcom = true;
      }
    }

    // 4. Check Secondary Objectives toggle
    if (secondaryObjToggle && secondaryObjChildren.length > 0) {
      const notionSecObjs = secondaryObjChildren
        .map((b) => (b.plainText || '').trim())
        .filter(Boolean);
      const currentSecObjs = (workingBrief.project.secondary_objectives || []).map((s) =>
        s.trim(),
      );
      if (
        notionSecObjs.length > 0 &&
        JSON.stringify(notionSecObjs) !== JSON.stringify(currentSecObjs)
      ) {
        detectedNumChange =
          detectedNumChange ||
          detectNumericReplacement(currentSecObjs.join(' '), notionSecObjs.join(' '));
        workingBrief.project.secondary_objectives = notionSecObjs;
        updatedInMarcom = true;
      }
    }

    // 5. Check Success Metrics toggle
    if (successMetricsToggle && successMetricsChildren.length > 0) {
      const notionMetrics = successMetricsChildren
        .map((b) => (b.plainText || '').trim())
        .filter(Boolean);
      const currentMetrics = (workingBrief.project.success_metrics || []).map((s) => s.trim());
      if (
        notionMetrics.length > 0 &&
        JSON.stringify(notionMetrics) !== JSON.stringify(currentMetrics)
      ) {
        detectedNumChange =
          detectedNumChange ||
          detectNumericReplacement(currentMetrics.join(' '), notionMetrics.join(' '));
        workingBrief.project.success_metrics = notionMetrics;
        updatedInMarcom = true;
      }
    }

    // 6. Check Guardrails & Tone toggle
    if (guardrailsChildren.length > 0) {
      for (const c of guardrailsChildren) {
        const text = (c.plainText || '').trim();
        if (text.toLowerCase().startsWith('outreach channels:')) {
          const channels = text
            .replace(/^outreach channels:\s*/i, '')
            .split(',')
            .map((ch) => ch.trim())
            .filter(Boolean);
          if (
            channels.length > 0 &&
            JSON.stringify(channels) !== JSON.stringify(workingBrief.outreach.channels)
          ) {
            workingBrief.outreach.channels = channels;
            updatedInMarcom = true;
          }
        } else if (
          text.toLowerCase().startsWith('tone & voice:') ||
          text.toLowerCase().startsWith('tone:')
        ) {
          const tones = text
            .replace(/^tone(?:\s*&\s*voice)?:\s*/i, '')
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean);
          if (
            tones.length > 0 &&
            JSON.stringify(tones) !== JSON.stringify(workingBrief.personalization.tone)
          ) {
            workingBrief.personalization.tone = tones;
            updatedInMarcom = true;
          }
        }
      }
    }

    // 7. Check Target Group toggles
    for (let tIdx = 0; tIdx < targetGroupToggles.length; tIdx += 1) {
      const tBlk = targetGroupToggles[tIdx]!;
      const tChildren = targetGroupChildrenList[tIdx] || [];
      const targetModel = workingBrief.targets[tIdx];
      if (!targetModel) continue;

      const titleMatch = (tBlk.plainText || '').match(
        /^Target Group:\s*(.+?)(?:\s*\((?:person|organisation|both)\))?(?:\s*—\s*Priority:.*)?$/i,
      );
      if (titleMatch?.[1]) {
        const parsedType = titleMatch[1].trim();
        if (parsedType && parsedType !== targetModel.target_type) {
          targetModel.target_type = parsedType;
          updatedInMarcom = true;
        }
      }

      const descChild = tChildren.find(
        (c) =>
          c.type === 'paragraph' &&
          ((c.plainText || '').startsWith('Target Description:') ||
            (!(c.plainText || '').startsWith('Qualification Criteria:') &&
              !(c.plainText || '').startsWith('Exclusions') &&
              !(c.plainText || '').startsWith('Standard campaign qualification'))),
      );
      if (descChild?.plainText) {
        const parsedDesc = descChild.plainText.replace(/^Target Description:\s*/i, '').trim();
        if (parsedDesc && parsedDesc !== (targetModel.description || '').trim()) {
          detectedNumChange =
            detectedNumChange ||
            detectNumericReplacement(targetModel.description || '', parsedDesc);
          targetModel.description = parsedDesc;
          updatedInMarcom = true;
        }
      }

      const geoChild = tChildren.find(
        (c) =>
          c.type === 'bulleted_list_item' && (c.plainText || '').startsWith('Geographies:'),
      );
      if (geoChild?.plainText) {
        const parsedGeos = geoChild.plainText
          .replace(/^Geographies:\s*/i, '')
          .split(',')
          .map((g) => g.trim())
          .filter(Boolean);
        if (
          parsedGeos.length > 0 &&
          JSON.stringify(parsedGeos) !== JSON.stringify(targetModel.geography || [])
        ) {
          targetModel.geography = parsedGeos;
          updatedInMarcom = true;
        }
      }

      // Parse qualification & exclusion criteria from target toggle children
      let inQualCriteria = false;
      let inExclusions = false;
      const parsedQualCriteria: string[] = [];
      const parsedExclusions: string[] = [];

      for (const c of tChildren) {
        const text = (c.plainText || '').trim();
        if (c.type === 'paragraph') {
          const lower = text.toLowerCase();
          if (lower.startsWith('qualification criteria')) {
            inQualCriteria = true;
            inExclusions = false;
            continue;
          } else if (lower.startsWith('exclusion') || lower.startsWith('hard disqualifier')) {
            inQualCriteria = false;
            inExclusions = true;
            continue;
          }
        }
        if (c.type === 'bulleted_list_item' && text) {
          if (inQualCriteria) {
            parsedQualCriteria.push(text);
          } else if (inExclusions) {
            parsedExclusions.push(text.replace(/^(?:⚠️\s*)+/, '').trim());
          }
        }
      }

      if (parsedQualCriteria.length > 0) {
        const currentQcTexts = (targetModel.qualification_criteria || []).map((qc) =>
          qc.text.trim(),
        );
        if (JSON.stringify(parsedQualCriteria) !== JSON.stringify(currentQcTexts)) {
          detectedNumChange =
            detectedNumChange ||
            detectNumericReplacement(currentQcTexts.join(' '), parsedQualCriteria.join(' '));
          targetModel.qualification_criteria = parsedQualCriteria.map((txt, qIdx) => ({
            text: txt,
            origin: targetModel.qualification_criteria?.[qIdx]?.origin || 'explicit',
            needs_operational_definition:
              targetModel.qualification_criteria?.[qIdx]?.needs_operational_definition ?? false,
          }));
          updatedInMarcom = true;
        }
      }

      if (parsedExclusions.length > 0) {
        const currentExcTexts = (targetModel.exclusion_criteria || []).map((exc) =>
          exc.text.trim(),
        );
        if (JSON.stringify(parsedExclusions) !== JSON.stringify(currentExcTexts)) {
          detectedNumChange =
            detectedNumChange ||
            detectNumericReplacement(currentExcTexts.join(' '), parsedExclusions.join(' '));
          targetModel.exclusion_criteria = parsedExclusions.map((txt, eIdx) => ({
            text: txt,
            origin: targetModel.exclusion_criteria?.[eIdx]?.origin || 'explicit',
            needs_operational_definition:
              targetModel.exclusion_criteria?.[eIdx]?.needs_operational_definition ?? false,
          }));
          updatedInMarcom = true;
        }
      }
    }

    // If the user updated a numeric target/goal (e.g., 2000 -> 3000) in any Campaign Hub block,
    // propagate that numeric update across co-occurring brief summary fields so Overview goal & summary never mismatch.
    if (detectedNumChange) {
      const { oldRaw, newRaw } = detectedNumChange;
      workingBrief.project.primary_objective = applyNumericReplacementToText(
        workingBrief.project.primary_objective,
        oldRaw,
        newRaw,
      );
      if (workingBrief.project.description) {
        workingBrief.project.description = applyNumericReplacementToText(
          workingBrief.project.description,
          oldRaw,
          newRaw,
        );
      }
      workingBrief.project.secondary_objectives = (
        workingBrief.project.secondary_objectives || []
      ).map((s) => applyNumericReplacementToText(s, oldRaw, newRaw));
      workingBrief.project.success_metrics = (workingBrief.project.success_metrics || []).map(
        (s) => applyNumericReplacementToText(s, oldRaw, newRaw),
      );
      if (workingBrief.outreach?.objectives) {
        workingBrief.outreach.objectives = workingBrief.outreach.objectives.map((s) =>
          applyNumericReplacementToText(s, oldRaw, newRaw),
        );
      }
      for (const t of workingBrief.targets) {
        if (t.description) {
          t.description = applyNumericReplacementToText(t.description, oldRaw, newRaw);
        }
        if (t.qualification_criteria) {
          t.qualification_criteria = t.qualification_criteria.map((qc) => ({
            ...qc,
            text: applyNumericReplacementToText(qc.text, oldRaw, newRaw),
          }));
        }
        if (t.exclusion_criteria) {
          t.exclusion_criteria = t.exclusion_criteria.map((exc) => ({
            ...exc,
            text: applyNumericReplacementToText(exc.text, oldRaw, newRaw),
          }));
        }
      }
    }
  }

  // Push updates to Notion Campaign Hub in-place ONLY where normalized content actually changed
  if (pushUpdatesToNotion) {
    const desiredHubTitle = `${(workingBrief.project.name || 'Campaign').trim()} — Intelligence & Outreach Hub`;
    if (existingPageTitle && existingPageTitle !== desiredHubTitle) {
      await updateNotionPage(accessToken, campaignPageId, {
        properties: {
          title: {
            title: [richText(desiredHubTitle)],
          },
        },
      }).catch(() => null);
    }

    if (summaryCalloutBlk) {
      const updatedCallout = buildCampaignSummaryCallout(workingBrief, syncStats);
      const oldNorm = normalizeComparableBlockText(summaryCalloutBlk.plainText ?? '');
      const newNorm = normalizeComparableBlockText(extractBlockPlainText(updatedCallout));
      if (oldNorm !== newNorm) {
        await updateNotionBlock(accessToken, summaryCalloutBlk.id, {
          callout: updatedCallout.callout,
        }).catch(() => null);
      }
    }

    if (descriptionBlocks[0] && workingBrief.project.description) {
      const currentDescBlockText = (descriptionBlocks[0].plainText || '').trim();
      const desiredDesc = workingBrief.project.description.trim();
      if (
        desiredDesc &&
        desiredDesc !== workingBrief.project.primary_objective.trim() &&
        currentDescBlockText !== desiredDesc
      ) {
        const updatedPara = paragraph(desiredDesc);
        await updateNotionBlock(accessToken, descriptionBlocks[0].id, {
          paragraph: updatedPara.paragraph,
        }).catch(() => null);
      }
    }

    if (isMarcomBriefEditedSinceSync) {
      // Sync Secondary Objectives children in-place if edited in Marcom
      const desiredSec = workingBrief.project.secondary_objectives || [];
      for (let i = 0; i < Math.min(secondaryObjChildren.length, desiredSec.length); i += 1) {
        if ((secondaryObjChildren[i]!.plainText || '').trim() !== desiredSec[i]!.trim()) {
          const updatedItem = bulletItem(desiredSec[i]!);
          await updateNotionBlock(accessToken, secondaryObjChildren[i]!.id, {
            bulleted_list_item: updatedItem.bulleted_list_item,
          }).catch(() => null);
        }
      }

      // Sync Success Metrics children in-place if edited in Marcom
      const desiredMetrics = workingBrief.project.success_metrics || [];
      for (
        let i = 0;
        i < Math.min(successMetricsChildren.length, desiredMetrics.length);
        i += 1
      ) {
        if ((successMetricsChildren[i]!.plainText || '').trim() !== desiredMetrics[i]!.trim()) {
          const updatedItem = bulletItem(desiredMetrics[i]!);
          await updateNotionBlock(accessToken, successMetricsChildren[i]!.id, {
            bulleted_list_item: updatedItem.bulleted_list_item,
          }).catch(() => null);
        }
      }

      // Sync Target Group descriptions & qualification criteria in-place if edited in Marcom
      for (let tIdx = 0; tIdx < targetGroupToggles.length; tIdx += 1) {
        const tChildren = targetGroupChildrenList[tIdx] || [];
        const targetModel = workingBrief.targets[tIdx];
        if (!targetModel) continue;

        const descChild = tChildren.find(
          (c) =>
            c.type === 'paragraph' && (c.plainText || '').startsWith('Target Description:'),
        );
        if (descChild && targetModel.description) {
          const desiredLine = `Target Description: ${targetModel.description}`;
          if ((descChild.plainText || '').trim() !== desiredLine.trim()) {
            const updatedPara = paragraph(desiredLine);
            await updateNotionBlock(accessToken, descChild.id, {
              paragraph: updatedPara.paragraph,
            }).catch(() => null);
          }
        }

        let inQc = false;
        let qcBulletIdx = 0;
        const desiredQcs = targetModel.qualification_criteria || [];
        for (const c of tChildren) {
          const lower = (c.plainText || '').toLowerCase();
          if (c.type === 'paragraph' && lower.startsWith('qualification criteria')) {
            inQc = true;
            qcBulletIdx = 0;
            continue;
          }
          if (c.type === 'paragraph' && (lower.startsWith('exclusion') || lower.startsWith('hard disqualifier'))) {
            inQc = false;
            continue;
          }
          if (inQc && c.type === 'bulleted_list_item' && qcBulletIdx < desiredQcs.length) {
            const desiredText = desiredQcs[qcBulletIdx]!.text.trim();
            if ((c.plainText || '').trim() !== desiredText) {
              const updatedBullet = bulletItem(desiredText);
              await updateNotionBlock(accessToken, c.id, {
                bulleted_list_item: updatedBullet.bulleted_list_item,
              }).catch(() => null);
            }
            qcBulletIdx += 1;
          }
        }
      }
    }
  }

  return { brief: workingBrief, updatedInMarcom };
}

function reconcileProspectResearchFromNotion(options: {
  entry: ResearchEntry;
  draft?: PersonalizationEntry;
  rowSnapshot?: NotionDatabaseRowSnapshot;
  pageOutreach?: ExtractedNotionOutreachBlocks;
  lastSyncedMs: number;
  notionEditMs: number;
}): {
  entry: ResearchEntry;
  changed: boolean;
} {
  const { entry, draft, rowSnapshot, pageOutreach, lastSyncedMs, notionEditMs } = options;
  if (!rowSnapshot && !pageOutreach) {
    return { entry, changed: false };
  }

  const marcomResearchMs = entry.record.researched_at
    ? Date.parse(entry.record.researched_at)
    : 0;
  const isMarcomResearchNewer =
    lastSyncedMs > 0 &&
    marcomResearchMs > lastSyncedMs + 2000 &&
    marcomResearchMs > notionEditMs;

  if (isMarcomResearchNewer) {
    return { entry, changed: false };
  }

  const expectedProps = buildProspectPageProperties(entry, draft);
  const working: ResearchEntry = JSON.parse(JSON.stringify(entry)) as ResearchEntry;
  const r = working.record;
  let changed = false;

  if (rowSnapshot) {
    // 1. Prospect Name
    const currentName = (r.identity.name || working.seed.name || '').trim();
    if (rowSnapshot.prospectName && rowSnapshot.prospectName.trim() !== currentName) {
      r.identity.name = rowSnapshot.prospectName.trim();
      working.seed.name = rowSnapshot.prospectName.trim();
      changed = true;
    }

    // 2. Role / Title
    const currentRole = (r.role || '').trim();
    if (
      rowSnapshot.role !== undefined &&
      (rowSnapshot.role || '').trim() !== currentRole
    ) {
      r.role = rowSnapshot.role?.trim() || null;
      working.seed.role = r.role || undefined;
      changed = true;
    }

    // 3. Organisation
    const currentOrg = (r.organisation || '').trim();
    if (
      rowSnapshot.organisation !== undefined &&
      (rowSnapshot.organisation || '').trim() !== currentOrg
    ) {
      r.organisation = rowSnapshot.organisation?.trim() || null;
      working.seed.organisation = r.organisation || undefined;
      changed = true;
    }

    // 4. Location
    const currentLocation = [r.location, r.country].filter(Boolean).join(', ').trim();
    if (
      rowSnapshot.location !== undefined &&
      (rowSnapshot.location || '').trim() !== currentLocation
    ) {
      r.location = rowSnapshot.location?.trim() || null;
      r.country = null;
      changed = true;
    }

    // 5. Email
    const expectedEmail: string | null = expectedProps.Email?.email || null;
    const notionEmail = normalizeEmail(rowSnapshot.email);
    if (rowSnapshot.email !== undefined && notionEmail !== expectedEmail) {
      const fallbackSourceId = r.sources[0]?.id || 'notion-sync';
      if (notionEmail) {
        const existingIdx = r.public_contact.findIndex((c) => c.kind === 'email');
        if (existingIdx >= 0) {
          r.public_contact[existingIdx] = {
            ...r.public_contact[existingIdx]!,
            value: notionEmail,
          };
        } else {
          r.public_contact.unshift({
            kind: 'email',
            value: notionEmail,
            is_professional: true,
            source_ids: [fallbackSourceId],
            confidence: 'verified',
          });
        }
      } else {
        r.public_contact = r.public_contact.filter((c) => c.kind !== 'email');
      }
      changed = true;
    }

    // 6. Phone
    const expectedPhone: string | null = expectedProps.Phone?.phone_number || null;
    const notionPhone = normalizePhone(rowSnapshot.phone);
    if (rowSnapshot.phone !== undefined && notionPhone !== expectedPhone) {
      const fallbackSourceId = r.sources[0]?.id || 'notion-sync';
      if (notionPhone) {
        const existingIdx = r.public_contact.findIndex((c) => c.kind === 'phone');
        if (existingIdx >= 0) {
          r.public_contact[existingIdx] = {
            ...r.public_contact[existingIdx]!,
            value: notionPhone,
          };
        } else {
          r.public_contact.push({
            kind: 'phone',
            value: notionPhone,
            is_professional: true,
            source_ids: [fallbackSourceId],
            confidence: 'verified',
          });
        }
      } else {
        r.public_contact = r.public_contact.filter((c) => c.kind !== 'phone');
      }
      changed = true;
    }

    // 7. LinkedIn URL
    const expectedLinkedin: string | null = expectedProps.LinkedIn?.url || null;
    const notionLinkedin = normalizeHttpUrl(rowSnapshot.linkedinUrl);
    if (rowSnapshot.linkedinUrl !== undefined && notionLinkedin !== expectedLinkedin) {
      const fallbackSourceId = r.sources[0]?.id || 'notion-sync';
      if (notionLinkedin) {
        const existingIdx = r.social_profiles.findIndex((s) => s.platform === 'linkedin');
        if (existingIdx >= 0) {
          r.social_profiles[existingIdx] = {
            ...r.social_profiles[existingIdx]!,
            profile_url: notionLinkedin,
          };
        } else {
          r.social_profiles.unshift({
            platform: 'linkedin',
            profile_url: notionLinkedin,
            username: null,
            display_name: r.identity.name,
            verified_status: true,
            confidence: 'verified',
            source_ids: [fallbackSourceId],
          });
        }
        working.seed.linkedin = notionLinkedin;
      } else {
        r.social_profiles = r.social_profiles.filter((s) => s.platform !== 'linkedin');
      }
      changed = true;
    }

    // 8. Website URL
    const expectedWebsite: string | null = expectedProps.Website?.url || null;
    const notionWebsite = normalizeHttpUrl(rowSnapshot.websiteUrl);
    if (rowSnapshot.websiteUrl !== undefined && notionWebsite !== expectedWebsite) {
      if (notionWebsite) {
        if (r.websites.length > 0) {
          r.websites[0] = {
            ...r.websites[0]!,
            url: notionWebsite,
          };
        } else {
          r.websites.push({
            url: notionWebsite,
            type: r.identity.entity_kind === 'organisation' ? 'company' : 'personal',
            title: r.identity.name,
          });
        }
        working.seed.website = notionWebsite;
      } else {
        r.websites = [];
      }
      changed = true;
    }

    // 9. Fit Score
    const currentFitScore =
      typeof r.fit?.score === 'number' ? Math.round(r.fit.score) : null;
    if (
      typeof rowSnapshot.fitScore === 'number' &&
      Number.isFinite(rowSnapshot.fitScore) &&
      Math.round(rowSnapshot.fitScore) !== currentFitScore
    ) {
      r.fit.score = Math.max(0, Math.min(100, Math.round(rowSnapshot.fitScore)));
      changed = true;
    }

    // 10. Qualification Rating
    const expectedRating: string | null =
      expectedProps['Qualification Rating']?.select?.name || null;
    if (
      rowSnapshot.qualificationRating &&
      rowSnapshot.qualificationRating !== expectedRating
    ) {
      const mappedBand = mapNotionQualificationRatingToBand(
        rowSnapshot.qualificationRating,
      );
      if (mappedBand && mappedBand !== r.fit.band) {
        r.fit.band = mappedBand;
        changed = true;
      }
    }
  }

  // 11. Executive Overview from dossier body blocks
  if (
    pageOutreach?.executiveOverview &&
    pageOutreach.executiveOverview.trim() !== (r.summary || '').trim()
  ) {
    r.summary = pageOutreach.executiveOverview.trim();
    changed = true;
  }

  if (changed && notionEditMs > 0) {
    r.researched_at = new Date(notionEditMs).toISOString();
  }

  return { entry: working, changed };
}

async function markNotionPageRemovedInMarcom(
  accessToken: string,
  pageId: string,
  removedAtIso: string,
): Promise<void> {
  const formattedDate = removedAtIso.replace('T', ' ').slice(0, 16) + ' UTC';
  const bannerLine = `⚠️ REMOVED IN MARCOM (${formattedDate}): This prospect was deleted from the Marcom workspace. This Notion page and all team comments/notes have been preserved for your records.`;

  await updateNotionPage(accessToken, pageId, {
    properties: {
      'Review Status': {
        select: { name: 'Removed in Marcom' },
      },
    },
  }).catch(() => null);

  const blocks = await listNotionBlockChildren(accessToken, pageId).catch(() => []);
  if (blocks[0]?.type === 'callout') {
    const existingText = blocks[0].plainText || '';
    if (!existingText.includes('REMOVED IN MARCOM')) {
      const updatedCallout = callout(
        [bannerLine, existingText].filter(Boolean).join('\n'),
        '⚠️',
        'yellow_background',
      );
      await updateNotionBlock(accessToken, blocks[0].id, {
        callout: updatedCallout.callout,
      }).catch(() => null);
    }
  }
}

export async function syncProjectToNotion(
  options: NotionSyncOptions,
  accessToken: string,
): Promise<NotionSyncResult> {
  const { projectId, prospects, drafts = {} } = options;
  let workingBrief: StructuredBrief = options.brief;
  const campaignName = (workingBrief.project.name || 'Campaign').trim();
  const hubTitle = `${campaignName} — Intelligence & Outreach Hub`;
  const nowIso = new Date().toISOString();

  const shortlistedCount =
    options.statsOverride?.shortlistedCount ??
    prospects.filter(
      (p) => p.review?.status === 'shortlisted' || p.relationship_status === 'contacted',
    ).length;
  const draftsReadyCount =
    options.statsOverride?.draftsReadyCount ??
    prospects.filter((p) => {
      const recId = p.record.record_id;
      const pName = (p.record.identity.name || p.seed.name || '').toLowerCase();
      const d =
        drafts[recId] ||
        Object.values(drafts).find((item) => item.prospect_name.toLowerCase() === pName);
      return Boolean(d?.copy);
    }).length;

  const syncStats: CampaignBriefSyncStats = {
    totalProspects: options.statsOverride?.totalProspects ?? prospects.length,
    shortlistedCount,
    draftsReadyCount,
    syncedAtIso: nowIso,
  };

  // 1. Check whether this project already has an active synced Campaign Hub & Database
  const storedSync =
    options.existingSync !== undefined
      ? options.existingSync
      : await getProjectNotionSync(projectId);

  let isResync = false;
  let parentPageId = options.parentPageId || storedSync?.parentPageId || '';
  let campaignPageId = '';
  let campaignPageUrl = '';
  let existingHubTitle: string | null = null;
  let existingHubLastEditedTime: string | null = null;
  const priorLastSyncedAt = storedSync?.priorLastSyncedAt || storedSync?.lastSyncedAt || null;
  let databaseId = '';
  let databaseUrl = '';
  const prospectPageIds: Record<string, string> = {
    ...(storedSync?.prospectPageIds || {}),
  };

  if (
    options.skipHubUpdate &&
    storedSync?.campaignPageId &&
    storedSync?.databaseId
  ) {
    isResync = true;
    parentPageId = storedSync.parentPageId || parentPageId;
    campaignPageId = storedSync.campaignPageId;
    campaignPageUrl = storedSync.campaignPageUrl || notionPageUrlFromId(storedSync.campaignPageId);
    databaseId = storedSync.databaseId;
    databaseUrl = storedSync.databaseUrl || notionPageUrlFromId(storedSync.databaseId);
  } else if (
    storedSync &&
    (!options.notionWorkspaceId ||
      !storedSync.notionWorkspaceId ||
      storedSync.notionWorkspaceId === options.notionWorkspaceId)
  ) {
    const [existingPage, existingDb] = await Promise.all([
      getNotionPage(accessToken, storedSync.campaignPageId),
      getNotionDatabase(accessToken, storedSync.databaseId),
    ]);

    if (
      existingPage &&
      !existingPage.archived &&
      !existingPage.inTrash &&
      existingDb &&
      !existingDb.archived &&
      !existingDb.inTrash
    ) {
      isResync = true;
      campaignPageId = existingPage.id;
      campaignPageUrl = existingPage.url;
      existingHubTitle = existingPage.title;
      existingHubLastEditedTime = existingPage.lastEditedTime;
      databaseId = existingDb.id;
      databaseUrl = existingDb.url;
      await ensureMissingDatabaseColumns(accessToken, databaseId, existingDb.properties);
    }
  }

  // 1b. If no stored sync state matched, check if an identical Campaign Hub already exists in Notion
  if (!isResync && !options.skipHubUpdate) {
    const recovered = await findRecoverableCampaignHub(accessToken, hubTitle);
    if (recovered) {
      isResync = true;
      parentPageId = recovered.parentPageId;
      campaignPageId = recovered.campaignPageId;
      campaignPageUrl = recovered.campaignPageUrl;
      existingHubTitle = hubTitle;
      databaseId = recovered.databaseId;
      databaseUrl = recovered.databaseUrl;
      await ensureMissingDatabaseColumns(
        accessToken,
        databaseId,
        recovered.existingProperties,
      );
    }
  }

  const reconciledChanges: NotionReconciledChanges = {
    updatedBrief: null,
    updatedResearchEntries: [],
    updatedDrafts: [],
    updatedReviews: [],
    pulledCount: 0,
  };

  // 2. Create or reconcile/update the Campaign Hub Page & Prospects Database
  if (isResync) {
    if (!options.skipHubUpdate) {
      try {
        const hubReconciliation = await reconcileCampaignHubWithBrief({
          accessToken,
          campaignPageId,
          existingPageTitle: existingHubTitle,
          existingPageLastEditedTime: existingHubLastEditedTime,
          brief: workingBrief,
          syncStats,
          configurationUpdatedAt: options.configurationUpdatedAt,
          lastSyncedAt: storedSync?.lastSyncedAt,
          pushUpdatesToNotion: true,
        });
        workingBrief = hubReconciliation.brief;
        if (hubReconciliation.updatedInMarcom) {
          reconciledChanges.updatedBrief = workingBrief;
          reconciledChanges.pulledCount += 1;
        }
      } catch {
        // Non-fatal if callout block was manually edited or removed in Notion
      }
    }
  } else {
    if (!parentPageId) {
      const accessible = await searchNotionAccessiblePages(accessToken);
      if (!accessible.length) {
        throw new Error(
          'No accessible Notion pages found. Please share at least one page with the Marcom integration in Notion (Settings > Connections, or reconnect and select a page).',
        );
      }
      parentPageId = accessible[0]!.id;
    }

    const briefBlocks = buildCampaignBriefBlocks(workingBrief, syncStats);

    let campaignPage: { id: string; url: string };
    try {
      campaignPage = await createNotionPage(accessToken, {
        parent: { page_id: parentPageId },
        icon: { type: 'emoji', emoji: '🚀' },
        properties: {
          title: {
            title: [richText(hubTitle)],
          },
        },
        children: briefBlocks.slice(0, 80),
      });
    } catch (createErr) {
      const accessible = await searchNotionAccessiblePages(accessToken).catch(() => []);
      const fallbackParentId = accessible.find((p) => p.id !== parentPageId)?.id || accessible[0]?.id;
      if (!fallbackParentId || fallbackParentId === parentPageId) {
        throw createErr;
      }
      parentPageId = fallbackParentId;
      campaignPage = await createNotionPage(accessToken, {
        parent: { page_id: parentPageId },
        icon: { type: 'emoji', emoji: '🚀' },
        properties: {
          title: {
            title: [richText(hubTitle)],
          },
        },
        children: briefBlocks.slice(0, 80),
      });
    }

    if (briefBlocks.length > 80) {
      await appendNotionBlocks(accessToken, campaignPage.id, briefBlocks.slice(80));
    }

    const dbSchema = buildProspectsDatabaseSchema(campaignPage.id);
    const database = await createNotionDatabase(accessToken, dbSchema);

    campaignPageId = campaignPage.id;
    campaignPageUrl = campaignPage.url;
    databaseId = database.id;
    databaseUrl = database.url;

    // Persist Hub & Database IDs immediately so subsequent batches or retries reuse them
    await saveProjectNotionSync({
      projectId,
      notionWorkspaceId: options.notionWorkspaceId || storedSync?.notionWorkspaceId || '',
      projectAccessToken: accessToken,
      parentPageId,
      campaignPageId,
      campaignPageUrl,
      databaseId,
      databaseUrl,
      prospectPageIds,
      syncedCount: 0,
      lastSyncedAt: nowIso,
    }).catch(() => undefined);
  }

  // 3. If re-syncing, index existing rows in the database to prevent duplicates and capture Notion edits
  const existingRowByRecordId = new Map<string, string>();
  const existingRowByName = new Map<string, string>();
  const rowSnapshotByPageId = new Map<string, NotionDatabaseRowSnapshot>();
  let existingRowsSnapshot: NotionDatabaseRowSnapshot[] =
    storedSync?.existingRowsSnapshot ?? [];

  if (isResync && options.skipHubUpdate) {
    for (const [recId, pageId] of Object.entries(prospectPageIds)) {
      if (pageId) existingRowByRecordId.set(recId, pageId);
    }
    for (const row of existingRowsSnapshot) {
      rowSnapshotByPageId.set(row.id, row);
      if (row.recordId && !existingRowByRecordId.has(row.recordId)) {
        existingRowByRecordId.set(row.recordId, row.id);
      }
      if (row.prospectName) {
        existingRowByName.set(row.prospectName.toLowerCase(), row.id);
      }
    }
  } else if (isResync) {
    try {
      const existingRows = await queryNotionDatabaseRows(accessToken, databaseId);
      existingRowsSnapshot = existingRows;
      const activeIds = new Set(existingRows.map((r) => r.id));

      for (const [recId, pageId] of Object.entries(prospectPageIds)) {
        if (activeIds.has(pageId)) {
          existingRowByRecordId.set(recId, pageId);
        } else {
          delete prospectPageIds[recId];
        }
      }

      const activeMarcomSet = options.activeRecordIds
        ? new Set(options.activeRecordIds)
        : prospects.length > 0
          ? new Set(prospects.map((p) => p.record.record_id))
          : null;

      const removedRowsToMark: NotionDatabaseRowSnapshot[] = [];

      for (const row of existingRows) {
        rowSnapshotByPageId.set(row.id, row);
        if (row.recordId && !existingRowByRecordId.has(row.recordId)) {
          existingRowByRecordId.set(row.recordId, row.id);
          prospectPageIds[row.recordId] = row.id;
        }
        if (row.prospectName) {
          existingRowByName.set(row.prospectName.toLowerCase(), row.id);
        }

        if (
          activeMarcomSet &&
          row.recordId &&
          !activeMarcomSet.has(row.recordId) &&
          row.reviewStatus !== 'Removed in Marcom'
        ) {
          removedRowsToMark.push(row);
        }
      }

      if (removedRowsToMark.length > 0) {
        await runWithConcurrency(removedRowsToMark, 2, async (removedRow) => {
          await markNotionPageRemovedInMarcom(accessToken, removedRow.id, nowIso);
        });
      }
    } catch {
      // Fall back to stored prospectPageIds if query fails
    }
  }

  // 4. Upsert Prospects as Database Rows/Pages with two-way reconciliation & comment-safe block updates
  let syncedCount = 0;
  let createdCount = 0;
  let updatedCount = 0;
  const errors: string[] = [];
  const lastSyncedMs =
    options.skipHubUpdate && priorLastSyncedAt
      ? Date.parse(priorLastSyncedAt)
      : storedSync?.lastSyncedAt
        ? Date.parse(storedSync.lastSyncedAt)
        : 0;

  await runWithConcurrency(prospects, 3, async (entry) => {
    const recId = entry.record.record_id;
    const prospectName = (entry.record.identity.name || entry.seed.name || 'Unnamed Prospect').trim();

    try {
      let workingEntry: ResearchEntry = entry;
      let matchingDraft: PersonalizationEntry | undefined =
        drafts[recId] ||
        Object.values(drafts).find(
          (d) => d.prospect_name.trim().toLowerCase() === prospectName.toLowerCase(),
        );

      const rowEmoji = workingEntry.record.identity.entity_kind === 'organisation' ? '🏢' : '👤';

      const targetPageId =
        existingRowByRecordId.get(recId) ||
        existingRowByName.get(prospectName.toLowerCase()) ||
        null;

      if (targetPageId) {
        try {
          const rowSnapshot = rowSnapshotByPageId.get(targetPageId);
          const existingBlocks = await listNotionBlockChildren(accessToken, targetPageId);
          const pageOutreach = extractNotionOutreachFromBlocks(existingBlocks);

          const rowEditMs = rowSnapshot?.lastEditedTime
            ? Date.parse(rowSnapshot.lastEditedTime)
            : 0;
          const notionEditMs = Math.max(
            Number.isFinite(rowEditMs) ? rowEditMs : 0,
            pageOutreach.maxBlockEditMs,
          );
          const marcomDraftMs = matchingDraft?.updated_at
            ? Date.parse(matchingDraft.updated_at)
            : matchingDraft?.generated_at
              ? Date.parse(matchingDraft.generated_at)
              : 0;
          const marcomReviewMs = workingEntry.review?.reviewed_at
            ? Date.parse(workingEntry.review.reviewed_at)
            : 0;

          // 4a. Reconcile Prospect Research fields (Name, Role, Org, Location, Contacts, Fit Score, Summary)
          const researchReconciled = reconcileProspectResearchFromNotion({
            entry: workingEntry,
            draft: matchingDraft,
            rowSnapshot,
            pageOutreach,
            lastSyncedMs,
            notionEditMs,
          });
          if (researchReconciled.changed) {
            workingEntry = researchReconciled.entry;
            if (matchingDraft && workingEntry.record.identity.name) {
              matchingDraft = {
                ...matchingDraft,
                prospect_name: workingEntry.record.identity.name,
              };
            }
            reconciledChanges.updatedResearchEntries?.push(workingEntry);
            reconciledChanges.pulledCount += 1;
          }

          let bodyOptions: ProspectBodyBlockOptions | undefined;
          let allowOutreachMutation = false;

          const isMarcomDraftEditedSinceSync =
            lastSyncedMs > 0 &&
            marcomDraftMs > lastSyncedMs + 2000 &&
            marcomDraftMs > notionEditMs;

          // 4b. Reconcile Outreach Drafts (Notion -> Marcom when Notion was edited or Marcom hasn't changed since last sync)
          if (!isMarcomDraftEditedSinceSync && matchingDraft?.copy) {
            const currentEmail = (matchingDraft.copy.email_body || '').trim();
            const currentSubject = (matchingDraft.copy.subject_lines?.[0]?.text || '').trim();
            const currentLinkedin = (matchingDraft.copy.linkedin_message || '').trim();

            const nextEmail =
              pageOutreach.emailBody && pageOutreach.emailBody !== currentEmail
                ? pageOutreach.emailBody
                : rowSnapshot?.primaryEmailDraft &&
                    rowSnapshot.primaryEmailDraft !== currentEmail
                  ? rowSnapshot.primaryEmailDraft
                  : currentEmail;

            const nextSubject =
              pageOutreach.subjectLine && pageOutreach.subjectLine !== currentSubject
                ? pageOutreach.subjectLine
                : rowSnapshot?.topSubjectLine && rowSnapshot.topSubjectLine !== currentSubject
                  ? rowSnapshot.topSubjectLine
                  : currentSubject;

            const nextLinkedin =
              pageOutreach.linkedinMessage && pageOutreach.linkedinMessage !== currentLinkedin
                ? pageOutreach.linkedinMessage
                : rowSnapshot?.linkedinDraft && rowSnapshot.linkedinDraft !== currentLinkedin
                  ? rowSnapshot.linkedinDraft
                  : currentLinkedin;

            const mappedOutreachStatus = mapNotionOutreachStatusToMarcom(
              rowSnapshot?.outreachStatus,
            );
            const nextStatus =
              mappedOutreachStatus && mappedOutreachStatus !== matchingDraft.status
                ? mappedOutreachStatus
                : matchingDraft.status;

            const copyChanged =
              nextEmail !== currentEmail ||
              nextSubject !== currentSubject ||
              nextLinkedin !== currentLinkedin;
            const statusChanged = nextStatus !== matchingDraft.status;

            if (copyChanged || statusChanged) {
              const updatedSubjectLines = [...(matchingDraft.copy.subject_lines || [])];
              if (nextSubject) {
                if (updatedSubjectLines.length > 0) {
                  updatedSubjectLines[0] = {
                    ...updatedSubjectLines[0]!,
                    text: nextSubject,
                  };
                } else {
                  updatedSubjectLines.push({ text: nextSubject, style: 'direct' });
                }
              }

              const editIso =
                notionEditMs > 0 ? new Date(notionEditMs).toISOString() : nowIso;
              matchingDraft = {
                ...matchingDraft,
                status: nextStatus,
                edited_by_human: copyChanged ? true : matchingDraft.edited_by_human,
                updated_at: editIso,
                copy: {
                  ...matchingDraft.copy,
                  subject_lines: updatedSubjectLines,
                  email_body: nextEmail,
                  linkedin_message: nextLinkedin || matchingDraft.copy.linkedin_message,
                },
              };
              reconciledChanges.updatedDrafts.push(matchingDraft);
              reconciledChanges.pulledCount += 1;
            }
            // Never overwrite Notion outreach blocks when the draft was not modified in Marcom
            allowOutreachMutation = false;
          } else if (isMarcomDraftEditedSinceSync && matchingDraft?.copy) {
            // 4c. Marcom has a genuinely newer or regenerated draft since last sync
            const priorNotionEmail = (
              pageOutreach.emailBody ||
              rowSnapshot?.primaryEmailDraft ||
              ''
            ).trim();
            const currentMarcomEmail = (matchingDraft.copy.email_body || '').trim();

            if (priorNotionEmail && priorNotionEmail !== currentMarcomEmail) {
              allowOutreachMutation = true;
              const formattedUpdTime = (
                Number.isFinite(marcomDraftMs) && marcomDraftMs > 0
                  ? new Date(marcomDraftMs)
                  : new Date()
              )
                .toISOString()
                .replace('T', ' ')
                .slice(0, 16);

              bodyOptions = {
                syncNote: `🔄 Outreach draft regenerated/updated in Marcom (${formattedUpdTime} UTC) — earlier inline comments below may refer to a previous version.`,
                previousDraftBackup: {
                  subjectLine:
                    pageOutreach.subjectLine || rowSnapshot?.topSubjectLine || null,
                  emailBody: priorNotionEmail,
                  linkedinMessage:
                    pageOutreach.linkedinMessage || rowSnapshot?.linkedinDraft || null,
                  savedAtIso: nowIso,
                },
              };
            } else {
              const currentSubject = (matchingDraft.copy.subject_lines?.[0]?.text || '').trim();
              const currentLinkedin = (matchingDraft.copy.linkedin_message || '').trim();
              allowOutreachMutation =
                (Boolean(pageOutreach.subjectLine) &&
                  pageOutreach.subjectLine !== currentSubject) ||
                (Boolean(pageOutreach.linkedinMessage) &&
                  pageOutreach.linkedinMessage !== currentLinkedin);
            }
          }

          // 4d. Reconcile Review Status & Sent / Contacted status changes made in Notion database
          const isMarcomReviewEditedSinceSync =
            lastSyncedMs > 0 &&
            marcomReviewMs > lastSyncedMs + 2000 &&
            marcomReviewMs > rowEditMs;

          if (!isMarcomReviewEditedSinceSync && (rowSnapshot?.reviewStatus || rowSnapshot?.outreachStatus)) {
            const expectedProps = buildProspectPageProperties(workingEntry, matchingDraft);
            const expectedNotionReview: string | undefined =
              expectedProps['Review Status']?.select?.name;
            const expectedNotionOutreach: string | undefined =
              expectedProps['Outreach Status']?.select?.name;

            const reviewChangedInNotion =
              Boolean(rowSnapshot.reviewStatus) &&
              rowSnapshot.reviewStatus !== expectedNotionReview;
            const outreachMarkedSentInNotion =
              rowSnapshot.outreachStatus?.trim().toLowerCase() === 'sent' &&
              expectedNotionOutreach !== 'Sent';

            if (reviewChangedInNotion || outreachMarkedSentInNotion) {
              const mappedReview =
                mapNotionReviewStatusToMarcom(rowSnapshot.reviewStatus) ??
                (outreachMarkedSentInNotion ? 'shortlisted' : null);
              const nextRelationshipStatus: 'contacted' | null =
                rowSnapshot.reviewStatus?.trim().toLowerCase() === 'sent / contacted' ||
                (outreachMarkedSentInNotion && !reviewChangedInNotion)
                  ? 'contacted'
                  : null;
              const currentRelationshipStatus: 'contacted' | null =
                workingEntry.relationship_status === 'contacted' ? 'contacted' : null;

              if (
                mappedReview &&
                (mappedReview !== workingEntry.review?.status ||
                  nextRelationshipStatus !== currentRelationshipStatus)
              ) {
                const reviewIso =
                  rowEditMs > 0 ? new Date(rowEditMs).toISOString() : nowIso;
                workingEntry = {
                  ...workingEntry,
                  relationship_status: nextRelationshipStatus,
                  review: {
                    project_id: projectId,
                    record_id: recId,
                    status: mappedReview,
                    note: workingEntry.review?.note ?? 'Status updated in Notion',
                    reviewed_at: reviewIso,
                    reviewed_by: 'notion-sync',
                  },
                };
                reconciledChanges.updatedReviews.push({
                  recordId: recId,
                  status: mappedReview,
                  note: workingEntry.review?.note ?? 'Status updated in Notion',
                  relationshipStatus: nextRelationshipStatus,
                });
                reconciledChanges.pulledCount += 1;
              }
            }
          }

          const properties = buildProspectPageProperties(workingEntry, matchingDraft);
          const bodyBlocks = buildProspectPageBodyBlocks(
            workingEntry,
            matchingDraft,
            bodyOptions,
          );

          // If Marcom did not modify the outreach draft copy, never overwrite Notion draft cells
          // so any inline user comments or formatting in Notion table cells are fully preserved
          if (!allowOutreachMutation) {
            delete properties['Primary Email Draft'];
            delete properties['Top Subject Line'];
            delete properties['LinkedIn / DM Draft'];
          }

          // If prospect fields in Notion already match Marcom, omit them from updateNotionPage
          if (rowSnapshot) {
            if (rowSnapshot.prospectName && rowSnapshot.prospectName === prospectName) {
              delete properties.Prospect;
            }
            if (
              rowSnapshot.reviewStatus &&
              rowSnapshot.reviewStatus === properties['Review Status']?.select?.name
            ) {
              delete properties['Review Status'];
            }
            if (
              rowSnapshot.outreachStatus &&
              rowSnapshot.outreachStatus === properties['Outreach Status']?.select?.name
            ) {
              delete properties['Outreach Status'];
            }
            if (
              rowSnapshot.role &&
              rowSnapshot.role === (workingEntry.record.role || '')
            ) {
              delete properties['Role / Title'];
            }
            if (
              rowSnapshot.organisation &&
              rowSnapshot.organisation === (workingEntry.record.organisation || '')
            ) {
              delete properties['Organisation'];
            }
            if (
              typeof rowSnapshot.fitScore === 'number' &&
              properties['Fit Score']?.number === rowSnapshot.fitScore
            ) {
              delete properties['Fit Score'];
            }
          }

          if (Object.keys(properties).length > 0) {
            await updateNotionPage(accessToken, targetPageId, {
              icon: { type: 'emoji', emoji: rowEmoji },
              properties,
            });
          }
          await replaceNotionPageBlocks(
            accessToken,
            targetPageId,
            bodyBlocks,
            existingBlocks,
            {
              allowOutreachMutation,
              allowSummaryCalloutMutation: !researchReconciled.changed,
            },
          );
          prospectPageIds[recId] = targetPageId;
          updatedCount += 1;
          syncedCount += 1;
          return;
        } catch (updateErr) {
          // If the row was trashed/deleted in Notion, fall through and recreate it cleanly
          if (
            !(
              updateErr instanceof NotionApiError &&
              (updateErr.status === 404 || updateErr.status === 400)
            )
          ) {
            throw updateErr;
          }
        }
      }

      const properties = buildProspectPageProperties(workingEntry, matchingDraft);
      const bodyBlocks = buildProspectPageBodyBlocks(workingEntry, matchingDraft);

      const createdPage = await createNotionPage(accessToken, {
        parent: { database_id: databaseId },
        icon: { type: 'emoji', emoji: rowEmoji },
        properties,
        children: bodyBlocks.slice(0, 80),
      });

      if (bodyBlocks.length > 80) {
        await appendNotionBlocks(accessToken, createdPage.id, bodyBlocks.slice(80));
      }

      prospectPageIds[recId] = createdPage.id;
      createdCount += 1;
      syncedCount += 1;
    } catch (err) {
      const msg = (err as Error).message || 'Unknown Notion error';
      errors.push(`Failed to sync "${prospectName}": ${msg}`);
    }
  });

  const lastSyncedAt = new Date().toISOString();
  const syncRecord: NotionProjectSyncRecord = {
    projectId,
    notionWorkspaceId: options.notionWorkspaceId || storedSync?.notionWorkspaceId || '',
    projectAccessToken: accessToken,
    parentPageId,
    campaignPageId,
    campaignPageUrl,
    databaseId,
    databaseUrl,
    prospectPageIds,
    syncedCount,
    lastSyncedAt,
    priorLastSyncedAt,
  };
  await saveProjectNotionSync(syncRecord);

  const success = prospects.length === 0 ? true : syncedCount > 0;

  return {
    success,
    url: campaignPageUrl,
    campaignPageId,
    campaignPageUrl,
    databaseId,
    databaseUrl,
    syncedCount,
    prospectsSynced: syncedCount,
    createdCount,
    updatedCount,
    failedCount: errors.length,
    isResync,
    lastSyncedAt,
    priorLastSyncedAt,
    prospectPageIds,
    existingRowsSnapshot,
    reconciledChanges:
      reconciledChanges.pulledCount > 0 ? reconciledChanges : undefined,
    errors: errors.length ? errors : undefined,
  };
}

export interface PullNotionChangesOptions {
  projectId: string;
  brief: StructuredBrief | null;
  configurationUpdatedAt?: string | null;
  prospects: ResearchEntry[];
  drafts: Record<string, PersonalizationEntry>;
  existingSync: NotionProjectSyncRecord;
}

/**
 * Lightweight pull check invoked on page refresh (`GET /api/projects/[id]/notion/sync`)
 * so edits made in Notion (Campaign Config, Prospect Research fields, Review Status, or Outreach Drafts)
 * automatically reflect in the Marcom workspace without requiring a manual Re-sync click.
 */
export async function pullNotionChangesForProject(
  options: PullNotionChangesOptions,
  accessToken: string,
): Promise<NotionReconciledChanges> {
  const { projectId, brief, configurationUpdatedAt, prospects, drafts, existingSync } = options;
  const reconciledChanges: NotionReconciledChanges = {
    updatedBrief: null,
    updatedResearchEntries: [],
    updatedDrafts: [],
    updatedReviews: [],
    pulledCount: 0,
  };

  if (!existingSync?.databaseId || !existingSync?.campaignPageId) {
    return reconciledChanges;
  }

  const lastSyncedMs = existingSync.lastSyncedAt
    ? Date.parse(existingSync.lastSyncedAt)
    : 0;
  const nowIso = new Date().toISOString();

  const [existingPage, existingRows] = await Promise.all([
    getNotionPage(accessToken, existingSync.campaignPageId).catch(() => null),
    queryNotionDatabaseRows(accessToken, existingSync.databaseId).catch(() => []),
  ]);

  if (existingPage && !existingPage.archived && !existingPage.inTrash && brief) {
    try {
      const shortlistedCount = prospects.filter(
        (p) => p.review?.status === 'shortlisted' || p.relationship_status === 'contacted',
      ).length;
      const draftsReadyCount = prospects.filter((p) =>
        Boolean(drafts[p.record.record_id]?.copy),
      ).length;

      const hubReconciled = await reconcileCampaignHubWithBrief({
        accessToken,
        campaignPageId: existingSync.campaignPageId,
        existingPageTitle: existingPage.title,
        existingPageLastEditedTime: existingPage.lastEditedTime,
        brief,
        syncStats: {
          totalProspects: prospects.length,
          shortlistedCount,
          draftsReadyCount,
          syncedAtIso: nowIso,
        },
        configurationUpdatedAt,
        lastSyncedAt: existingSync.lastSyncedAt,
        pushUpdatesToNotion: false,
      });

      if (hubReconciled.updatedInMarcom) {
        reconciledChanges.updatedBrief = hubReconciled.brief;
        reconciledChanges.pulledCount += 1;
      }
    } catch {
      // Non-fatal
    }
  }

  if (existingRows.length === 0 || prospects.length === 0) {
    if (reconciledChanges.pulledCount > 0) {
      await saveProjectNotionSync({
        ...existingSync,
        lastSyncedAt: nowIso,
      }).catch(() => undefined);
    }
    return reconciledChanges;
  }

  const rowByRecordId = new Map<string, NotionDatabaseRowSnapshot>();
  const rowByName = new Map<string, NotionDatabaseRowSnapshot>();
  for (const row of existingRows) {
    if (row.recordId) rowByRecordId.set(row.recordId, row);
    if (row.prospectName) rowByName.set(row.prospectName.toLowerCase(), row);
  }

  await runWithConcurrency(prospects, 3, async (entry) => {
    const recId = entry.record.record_id;
    const pName = (entry.record.identity.name || entry.seed.name || '').trim();
    const rowSnapshot =
      rowByRecordId.get(recId) ||
      rowByName.get(pName.toLowerCase()) ||
      (existingSync.prospectPageIds?.[recId]
        ? existingRows.find((r) => r.id === existingSync.prospectPageIds[recId])
        : undefined);

    if (!rowSnapshot) return;

    let workingEntry: ResearchEntry = entry;
    let matchingDraft: PersonalizationEntry | undefined =
      drafts[recId] ||
      Object.values(drafts).find(
        (d) => d.prospect_name.trim().toLowerCase() === pName.toLowerCase(),
      );

    const rowEditMs = rowSnapshot.lastEditedTime ? Date.parse(rowSnapshot.lastEditedTime) : 0;
    const marcomDraftMs = matchingDraft?.updated_at
      ? Date.parse(matchingDraft.updated_at)
      : matchingDraft?.generated_at
        ? Date.parse(matchingDraft.generated_at)
        : 0;
    const marcomResearchMs = workingEntry.record.researched_at
      ? Date.parse(workingEntry.record.researched_at)
      : 0;
    const marcomReviewMs = workingEntry.review?.reviewed_at
      ? Date.parse(workingEntry.review.reviewed_at)
      : 0;

    // Fetch page blocks if the Notion row was edited since last sync or since the Marcom record/draft timestamp
    let pageOutreach: ExtractedNotionOutreachBlocks | undefined;
    const shouldInspectPageBlocks =
      rowEditMs > 0 &&
      (lastSyncedMs === 0 ||
        rowEditMs > lastSyncedMs - 10_000 ||
        (marcomDraftMs > 0 && rowEditMs > marcomDraftMs + 1000) ||
        (marcomResearchMs > 0 && rowEditMs > marcomResearchMs + 1000));

    if (shouldInspectPageBlocks) {
      const blocks = await listNotionBlockChildren(accessToken, rowSnapshot.id).catch(
        () => [] as NotionBlockChild[],
      );
      if (blocks.length > 0) {
        pageOutreach = extractNotionOutreachFromBlocks(blocks);
      }
    }

    const notionEditMs = Math.max(
      Number.isFinite(rowEditMs) ? rowEditMs : 0,
      pageOutreach?.maxBlockEditMs ?? 0,
    );

    // 1. Reconcile Prospect Research fields
    const researchReconciled = reconcileProspectResearchFromNotion({
      entry: workingEntry,
      draft: matchingDraft,
      rowSnapshot,
      pageOutreach,
      lastSyncedMs,
      notionEditMs,
    });
    if (researchReconciled.changed) {
      workingEntry = researchReconciled.entry;
      reconciledChanges.updatedResearchEntries?.push(workingEntry);
      reconciledChanges.pulledCount += 1;
    }

    // 2. Reconcile Outreach Drafts
    const isMarcomDraftEditedSinceSync =
      lastSyncedMs > 0 &&
      marcomDraftMs > lastSyncedMs + 2000 &&
      marcomDraftMs > notionEditMs;

    if (!isMarcomDraftEditedSinceSync && matchingDraft?.copy) {
      const currentEmail = (matchingDraft.copy.email_body || '').trim();
      const currentSubject = (matchingDraft.copy.subject_lines?.[0]?.text || '').trim();
      const currentLinkedin = (matchingDraft.copy.linkedin_message || '').trim();

      const nextEmail =
        pageOutreach?.emailBody && pageOutreach.emailBody !== currentEmail
          ? pageOutreach.emailBody
          : rowSnapshot.primaryEmailDraft && rowSnapshot.primaryEmailDraft !== currentEmail
            ? rowSnapshot.primaryEmailDraft
            : currentEmail;

      const nextSubject =
        pageOutreach?.subjectLine && pageOutreach.subjectLine !== currentSubject
          ? pageOutreach.subjectLine
          : rowSnapshot.topSubjectLine && rowSnapshot.topSubjectLine !== currentSubject
            ? rowSnapshot.topSubjectLine
            : currentSubject;

      const nextLinkedin =
        pageOutreach?.linkedinMessage && pageOutreach.linkedinMessage !== currentLinkedin
          ? pageOutreach.linkedinMessage
          : rowSnapshot.linkedinDraft && rowSnapshot.linkedinDraft !== currentLinkedin
            ? rowSnapshot.linkedinDraft
            : currentLinkedin;

      const mappedOutreachStatus = mapNotionOutreachStatusToMarcom(rowSnapshot.outreachStatus);
      const nextStatus =
        mappedOutreachStatus && mappedOutreachStatus !== matchingDraft.status
          ? mappedOutreachStatus
          : matchingDraft.status;

      const copyChanged =
        nextEmail !== currentEmail ||
        nextSubject !== currentSubject ||
        nextLinkedin !== currentLinkedin;
      const statusChanged = nextStatus !== matchingDraft.status;

      if (copyChanged || statusChanged) {
        const updatedSubjectLines = [...(matchingDraft.copy.subject_lines || [])];
        if (nextSubject) {
          if (updatedSubjectLines.length > 0) {
            updatedSubjectLines[0] = {
              ...updatedSubjectLines[0]!,
              text: nextSubject,
            };
          } else {
            updatedSubjectLines.push({ text: nextSubject, style: 'direct' });
          }
        }

        const editIso = notionEditMs > 0 ? new Date(notionEditMs).toISOString() : nowIso;
        matchingDraft = {
          ...matchingDraft,
          prospect_name:
            workingEntry.record.identity.name || matchingDraft.prospect_name,
          status: nextStatus,
          edited_by_human: copyChanged ? true : matchingDraft.edited_by_human,
          updated_at: editIso,
          copy: {
            ...matchingDraft.copy,
            subject_lines: updatedSubjectLines,
            email_body: nextEmail,
            linkedin_message: nextLinkedin || matchingDraft.copy.linkedin_message,
          },
        };
        reconciledChanges.updatedDrafts.push(matchingDraft);
        reconciledChanges.pulledCount += 1;
      }
    }

    // 3. Reconcile Review Status & Sent / Contacted status
    const isMarcomReviewEditedSinceSync =
      lastSyncedMs > 0 && marcomReviewMs > lastSyncedMs + 2000 && marcomReviewMs > rowEditMs;

    if (!isMarcomReviewEditedSinceSync && (rowSnapshot.reviewStatus || rowSnapshot.outreachStatus)) {
      const expectedProps = buildProspectPageProperties(workingEntry, matchingDraft);
      const expectedNotionReview: string | undefined =
        expectedProps['Review Status']?.select?.name;
      const expectedNotionOutreach: string | undefined =
        expectedProps['Outreach Status']?.select?.name;

      const reviewChangedInNotion =
        Boolean(rowSnapshot.reviewStatus) &&
        rowSnapshot.reviewStatus !== expectedNotionReview;
      const outreachMarkedSentInNotion =
        rowSnapshot.outreachStatus?.trim().toLowerCase() === 'sent' &&
        expectedNotionOutreach !== 'Sent';

      if (reviewChangedInNotion || outreachMarkedSentInNotion) {
        const mappedReview =
          mapNotionReviewStatusToMarcom(rowSnapshot.reviewStatus) ??
          (outreachMarkedSentInNotion ? 'shortlisted' : null);
        const nextRelationshipStatus: 'contacted' | null =
          rowSnapshot.reviewStatus?.trim().toLowerCase() === 'sent / contacted' ||
          (outreachMarkedSentInNotion && !reviewChangedInNotion)
            ? 'contacted'
            : null;
        const currentRelationshipStatus: 'contacted' | null =
          workingEntry.relationship_status === 'contacted' ? 'contacted' : null;

        if (
          mappedReview &&
          (mappedReview !== workingEntry.review?.status ||
            nextRelationshipStatus !== currentRelationshipStatus)
        ) {
          reconciledChanges.updatedReviews.push({
            recordId: recId,
            status: mappedReview,
            note: workingEntry.review?.note ?? 'Status updated in Notion',
            relationshipStatus: nextRelationshipStatus,
          });
          reconciledChanges.pulledCount += 1;
        }
      }
    }
  });

  if (reconciledChanges.pulledCount > 0) {
    await saveProjectNotionSync({
      ...existingSync,
      lastSyncedAt: nowIso,
    }).catch(() => undefined);
  }

  return reconciledChanges;
}

export interface TargetedNotionSyncOptions {
  projectId: string;
  brief?: StructuredBrief | null;
  targetEntries: ResearchEntry[];
  draftsByRecordId?: Record<string, PersonalizationEntry>;
  allProspects?: ResearchEntry[];
  req?: Request | null;
}

export interface TargetedNotionSyncResult {
  synced: boolean;
  campaignPageUrl?: string;
  prospectPageIds?: Record<string, string>;
  prospectPageUrls?: Record<string, string>;
  updatedRecords?: number;
}

/**
 * Automatically updates only the modified prospect row(s) & dossier blocks in Notion
 * IF AND ONLY IF this campaign has already been explicitly synced to the active Notion workspace.
 * Never creates hubs for unsynced campaigns, and safely catches errors so primary workflows never fail.
 */
export async function syncConnectedProjectRecordsToNotion(
  options: TargetedNotionSyncOptions,
): Promise<TargetedNotionSyncResult> {
  try {
    if (!options.targetEntries.length) {
      return { synced: false };
    }

    const connection = await getProjectNotionConnection(options.projectId, options.req);
    if (!connection?.accessToken) {
      return { synced: false };
    }

    const storedSync = await getProjectNotionSync(options.projectId);
    if (!storedSync?.databaseId) {
      return { synced: false };
    }

    if (
      storedSync.notionWorkspaceId &&
      connection.workspaceId &&
      storedSync.notionWorkspaceId !== connection.workspaceId
    ) {
      return { synced: false };
    }

    const existingDb = await getNotionDatabase(connection.accessToken, storedSync.databaseId);
    if (!existingDb || existingDb.archived || existingDb.inTrash) {
      return { synced: false };
    }

    await ensureMissingDatabaseColumns(
      connection.accessToken,
      existingDb.id,
      existingDb.properties,
    );

    const drafts = options.draftsByRecordId || {};
    const prospectPageIds: Record<string, string> = {
      ...(storedSync.prospectPageIds || {}),
    };

    // Only query database rows if any target record ID is missing from our stored mapping
    const hasMissingMapping = options.targetEntries.some(
      (e) => !prospectPageIds[e.record.record_id],
    );
    const fallbackByName = new Map<string, string>();
    if (hasMissingMapping) {
      const existingRows = await queryNotionDatabaseRows(
        connection.accessToken,
        existingDb.id,
      ).catch(() => []);
      for (const row of existingRows) {
        if (row.recordId && !prospectPageIds[row.recordId]) {
          prospectPageIds[row.recordId] = row.id;
        }
        if (row.prospectName) {
          fallbackByName.set(row.prospectName.toLowerCase(), row.id);
        }
      }
    }

    let updatedRecords = 0;
    const prospectPageUrls: Record<string, string> = {};

    await runWithConcurrency(options.targetEntries, 2, async (entry) => {
      const recId = entry.record.record_id;
      const prospectName = (
        entry.record.identity.name ||
        entry.seed.name ||
        'Unnamed Prospect'
      ).trim();

      const matchingDraft =
        drafts[recId] ||
        Object.values(drafts).find(
          (d) => d.prospect_name.trim().toLowerCase() === prospectName.toLowerCase(),
        );

      const properties = buildProspectPageProperties(entry, matchingDraft);
      const rowEmoji = entry.record.identity.entity_kind === 'organisation' ? '🏢' : '👤';

      const targetPageId =
        prospectPageIds[recId] || fallbackByName.get(prospectName.toLowerCase()) || null;

      if (targetPageId) {
        try {
          const existingBlocks = await listNotionBlockChildren(
            connection.accessToken,
            targetPageId,
          );
          const pageOutreach = extractNotionOutreachFromBlocks(existingBlocks);
          let bodyOptions: ProspectBodyBlockOptions | undefined;

          if (
            matchingDraft?.copy &&
            pageOutreach.emailBody &&
            pageOutreach.emailBody.trim() !== (matchingDraft.copy.email_body || '').trim()
          ) {
            const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 16);
            bodyOptions = {
              syncNote: `🔄 Outreach draft regenerated/updated in Marcom (${nowStr} UTC) — earlier inline comments below may refer to a previous version.`,
              previousDraftBackup: {
                subjectLine: pageOutreach.subjectLine,
                emailBody: pageOutreach.emailBody,
                linkedinMessage: pageOutreach.linkedinMessage,
              },
            };
          }

          const bodyBlocks = buildProspectPageBodyBlocks(entry, matchingDraft, bodyOptions);
          await updateNotionPage(connection.accessToken, targetPageId, {
            icon: { type: 'emoji', emoji: rowEmoji },
            properties,
          });
          await replaceNotionPageBlocks(
            connection.accessToken,
            targetPageId,
            bodyBlocks,
            existingBlocks,
          );
          prospectPageIds[recId] = targetPageId;
          prospectPageUrls[recId] = notionPageUrlFromId(targetPageId);
          updatedRecords += 1;
          return;
        } catch (updateErr) {
          if (
            !(
              updateErr instanceof NotionApiError &&
              (updateErr.status === 404 || updateErr.status === 400)
            )
          ) {
            throw updateErr;
          }
        }
      }

      const bodyBlocks = buildProspectPageBodyBlocks(entry, matchingDraft);

      const createdPage = await createNotionPage(connection.accessToken, {
        parent: { database_id: existingDb.id },
        icon: { type: 'emoji', emoji: rowEmoji },
        properties,
        children: bodyBlocks.slice(0, 80),
      });

      if (bodyBlocks.length > 80) {
        await appendNotionBlocks(connection.accessToken, createdPage.id, bodyBlocks.slice(80));
      }

      prospectPageIds[recId] = createdPage.id;
      prospectPageUrls[recId] = createdPage.url || notionPageUrlFromId(createdPage.id);
      updatedRecords += 1;
    });

    const nowIso = new Date().toISOString();

    // Refresh Campaign Hub top callout pipeline stats if full prospect list & brief are available
    if (options.brief && options.allProspects && storedSync.campaignPageId) {
      try {
        const topBlocks = await listNotionBlockChildren(
          connection.accessToken,
          storedSync.campaignPageId,
        );
        if (topBlocks[0]?.type === 'callout') {
          const shortlistedCount = options.allProspects.filter(
            (p) =>
              p.review?.status === 'shortlisted' ||
              p.relationship_status === 'contacted' ||
              Boolean(drafts[p.record.record_id]?.copy),
          ).length;
          const draftsReadyCount = options.allProspects.filter((p) =>
            Boolean(drafts[p.record.record_id]?.copy),
          ).length;
          const updatedCallout = buildCampaignSummaryCallout(options.brief, {
            totalProspects: options.allProspects.length,
            shortlistedCount,
            draftsReadyCount,
            syncedAtIso: nowIso,
          });
          const oldNorm = normalizeComparableBlockText(topBlocks[0].plainText ?? '');
          const newNorm = normalizeComparableBlockText(extractBlockPlainText(updatedCallout));
          if (oldNorm !== newNorm) {
            await updateNotionBlock(connection.accessToken, topBlocks[0].id, {
              callout: updatedCallout.callout,
            });
          }
        }
      } catch {
        // Non-fatal
      }
    }

    await saveProjectNotionSync({
      ...storedSync,
      prospectPageIds,
      syncedCount: Object.keys(prospectPageIds).length,
      lastSyncedAt: storedSync.lastSyncedAt || nowIso,
    });

    return {
      synced: updatedRecords > 0,
      campaignPageUrl: storedSync.campaignPageUrl,
      prospectPageIds,
      prospectPageUrls,
      updatedRecords,
    };
  } catch (err) {
    console.warn('Background Notion record sync warning:', err);
    return { synced: false };
  }
}

export interface MarkDeletedNotionRecordsOptions {
  projectId: string;
  deletedRecordIds?: string[];
  allDeleted?: boolean;
  req?: Request | null;
}

/**
 * When prospects are deleted in Marcom, marks their corresponding Notion rows as "Removed in Marcom"
 * and prepends a warning callout banner — preserving the Notion page and any team comments/notes.
 */
export async function markDeletedProjectRecordsInNotion(
  options: MarkDeletedNotionRecordsOptions,
): Promise<void> {
  try {
    const connection = await getProjectNotionConnection(options.projectId, options.req);
    if (!connection?.accessToken) return;

    const storedSync = await getProjectNotionSync(options.projectId);
    if (!storedSync?.databaseId) return;

    if (
      storedSync.notionWorkspaceId &&
      connection.workspaceId &&
      storedSync.notionWorkspaceId !== connection.workspaceId
    ) {
      return;
    }

    const pageIdsMap = storedSync.prospectPageIds || {};
    const targetIds = options.allDeleted
      ? Object.keys(pageIdsMap)
      : (options.deletedRecordIds || []).filter((id) => Boolean(pageIdsMap[id]));

    if (!targetIds.length) return;

    const nowIso = new Date().toISOString();
    await runWithConcurrency(targetIds, 2, async (recId) => {
      const pageId = pageIdsMap[recId];
      if (!pageId) return;
      await markNotionPageRemovedInMarcom(connection.accessToken, pageId, nowIso);
    });
  } catch (err) {
    console.warn('Background Notion delete status sync warning:', err);
  }
}
