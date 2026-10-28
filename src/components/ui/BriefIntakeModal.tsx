'use client';

import { useState, useRef } from 'react';
import PrimaryButton from './PrimaryButton';
import SecondaryButton from './SecondaryButton';
import type { StructuredBrief } from '@/marcom/schemas/structured-brief';
import CampaignConfigurationForm from '@/components/campaign/CampaignConfigurationForm';
import { authenticatedFetch } from '@/auth/client';

interface BriefIntakeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (projectId?: string) => void;
}

type Step = 'UPLOAD' | 'PROCESSING' | 'QUESTIONS' | 'REVIEW';
type SectionKey = 'overview' | 'goals' | 'work' | 'audience' | 'constraints';

interface BriefSection {
  key: SectionKey;
  title: string;
  prompt: string;
  helper: string;
  placeholder: string;
  required?: boolean;
}

/** The five general-purpose brief sections. Titles are used as labels in the text sent to the Brief Analyzer. */
const BRIEF_SECTIONS: BriefSection[] = [
  { key: 'overview', title: 'Project Overview', prompt: 'What is this project about?', helper: 'Describe the company, product, initiative or situation and provide any important background.', placeholder: 'Describe your project here...', required: true },
  { key: 'goals', title: 'Goals and Objectives', prompt: 'What are you trying to achieve?', helper: "Explain the problems you're solving, the goals you're pursuing and the outcomes you want.", placeholder: 'Explain your main goals and desired outcomes...', required: true },
  { key: 'work', title: 'What Needs to Be Done?', prompt: 'What do you need MARCOM to help you with?', helper: 'Describe the work you need, such as research, finding contacts, partnerships, outreach, campaigns, content or other activities.', placeholder: 'Describe the work you want to carry out...', required: true },
  { key: 'audience', title: 'Target Audience and Focus', prompt: 'Who or what should MARCOM focus on?', helper: 'Describe relevant people, organisations, industries, locations, communities or other areas of focus.', placeholder: 'Describe your target audience or area of focus...', required: true },
  { key: 'constraints', title: 'Important Context and Constraints', prompt: 'What else should MARCOM know?', helper: 'Include existing plans, budget, deadlines, resources, requirements, restrictions or anything MARCOM should avoid.', placeholder: 'Add important instructions, guidelines or limitations...' },
];

const EMPTY_SECTIONS: Record<SectionKey, string> = { overview: '', goals: '', work: '', audience: '', constraints: '' };

/** Combines the user's answers and any supporting material into one clearly labelled brief. Answers are preserved verbatim. */
function composeBrief(
  name: string,
  sections: Record<SectionKey, string>,
  documents: { name: string; text: string }[],
  links: string[],
): string {
  const parts = [
    'MARCOM STRUCTURED PROJECT BRIEF',
    'The user confirmed the sections below in their own words. Any non-empty section answers are the primary source of truth.',
    `Project name: ${name.trim() || '(not provided - suggest one from the brief)'}`,
    ...BRIEF_SECTIONS.map((s) => `## ${s.title}\n${sections[s.key].trim() || '(not provided)'}`),
  ];
  if (documents.length || links.length) {
    parts.push('=== SUPPORTING MATERIAL (supplements the answers above; may fill sections marked "(not provided)", but must never override user answers) ===');
    for (const doc of documents) parts.push(`### Supporting document: ${doc.name}\n${doc.text}`);
    if (links.length) parts.push(`### Reference links\n${links.map((l) => `- ${l}`).join('\n')}`);
  }
  return parts.join('\n\n');
}

const isGoogleDoc = (link: string) => /^https:\/\/docs\.google\.com\/document\//i.test(link);
const SUPPORTED_EXTENSIONS = ['.pdf', '.docx', '.txt', '.md'];

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function getFileBadge(name: string): string {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  if (ext === '.pdf') return 'PDF';
  if (ext === '.docx') return 'DOCX';
  if (ext === '.md') return 'MD';
  return 'TXT';
}

export default function BriefIntakeModal({ isOpen, onClose, onSuccess }: BriefIntakeModalProps) {
  const [step, setStep] = useState<Step>('UPLOAD');

  // Input state
  const [sections, setSections] = useState<Record<SectionKey, string>>(EMPTY_SECTIONS);
  const [projectName, setProjectName] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [linksText, setLinksText] = useState('');
  const [rawBriefText, setRawBriefText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Processing & metadata state
  const [extractedText, setExtractedText] = useState('');
  const [structuredBrief, setStructuredBrief] = useState<StructuredBrief | null>(null);
  const [sourceFileId, setSourceFileId] = useState<string | null>(null);
  const [sourceFileName, setSourceFileName] = useState<string | null>(null);
  const [extractionWarnings, setExtractionWarnings] = useState<string[]>([]);
  const [processingStage, setProcessingStage] = useState<'EXTRACTING' | 'PREFILLING' | 'ANALYZING'>('EXTRACTING');
  
  // Create Project state
  const [isCreating, setIsCreating] = useState(false);

  const requiredSections = BRIEF_SECTIONS.filter((s) => s.required);
  const missingSections = requiredSections.filter((s) => !sections[s.key]?.trim());
  const allMandatoryAnswered = missingSections.length === 0;

  if (!isOpen) return null;

  const handleReset = () => {
    setStep('UPLOAD');
    setSections(EMPTY_SECTIONS);
    setProjectName('');
    setFiles([]);
    setRawBriefText('');
    setIsDragging(false);
    setLinksText('');
    setError(null);
    setStructuredBrief(null);
    setSourceFileId(null);
    setSourceFileName(null);
    setExtractionWarnings([]);
  };

  const addFiles = (incoming: File[]) => {
    setError(null);
    const valid: File[] = [];
    const rejected: string[] = [];

    for (const file of incoming) {
      const lower = file.name.toLowerCase();
      if (SUPPORTED_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
        valid.push(file);
      } else {
        rejected.push(file.name);
      }
    }

    if (rejected.length > 0) {
      setError(`Unsupported file format (${rejected.join(', ')}). Please upload a PDF (.pdf), Word document (.docx), TXT (.txt) or Markdown (.md) file.`);
    }

    if (valid.length > 0) {
      // Use the chosen file
      setFiles([valid[0]]);
    }
  };

  /** Runs one /api/extract call and returns its JSON. Throws a labelled error on failure. */
  const extractSupporting = async (formData: FormData, label: string) => {
    const res = await authenticatedFetch('/api/extract', { method: 'POST', body: formData });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) throw new Error(`Could not read brief file "${label}": ${data?.error || 'invalid server response'}. Remove it or try again.`);
    return data;
  };

  /** Step 1 -> Step 2: Extracts the uploaded brief document and auto-fills the 4 questions + project name */
  const extractAndPrefill = async () => {
    setError(null);
    const links = linksText.split(/\s+/).map((l) => l.trim()).filter(Boolean);
    const hasFiles = files.length > 0;
    const hasLinks = links.some(isGoogleDoc);
    const hasRaw = rawBriefText.trim().length > 0;

    if (!hasFiles && !hasLinks && !hasRaw) {
      setError('Please upload a PDF/Word brief, paste a Google Doc link, or enter brief text to auto-fill the questions.');
      return;
    }

    try {
      setStep('PROCESSING');
      setProcessingStage('EXTRACTING');

      const documents: { name: string; text: string }[] = [];
      const warnings: string[] = [];
      let firstFileId: string | null = null;
      let firstFileName: string | null = null;

      for (const f of files) {
        const fd = new FormData();
        fd.append('file', f);
        const data = await extractSupporting(fd, f.name);
        documents.push({ name: data.source_name || f.name, text: data.extracted_text });
        warnings.push(...(data.warnings || []).map((w: string) => `${f.name}: ${w}`));
        if (!firstFileId && data.source_file_id) {
          firstFileId = data.source_file_id;
          firstFileName = data.source_name || f.name;
        }
      }

      for (const link of links.filter(isGoogleDoc)) {
        const fd = new FormData();
        fd.append('url', link);
        const data = await extractSupporting(fd, link);
        documents.push({ name: link, text: data.extracted_text });
      }

      if (hasRaw) {
        documents.push({ name: 'Provided Brief Text', text: rawBriefText.trim() });
      }

      setSourceFileId(firstFileId);
      setSourceFileName(firstFileName);
      setExtractionWarnings(warnings);

      const combinedText = documents.map((d) => `=== ${d.name} ===\n${d.text}`).join('\n\n');
      setExtractedText(combinedText);

      setProcessingStage('PREFILLING');

      const prefillRes = await authenticatedFetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ briefText: combinedText, mode: 'prefill' }),
      });
      const prefillData = await prefillRes.json().catch(() => null);

      if (!prefillRes.ok || !prefillData?.success) {
        throw new Error(prefillData?.error || 'Could not automatically answer questions from this brief. You can still fill them in manually.');
      }

      if (prefillData.project_name && !projectName.trim()) {
        setProjectName(prefillData.project_name);
      }
      setSections({
        overview: prefillData.sections?.overview || '',
        goals: prefillData.sections?.goals || '',
        work: prefillData.sections?.work || '',
        audience: prefillData.sections?.audience || '',
        constraints: prefillData.sections?.constraints || '',
      });

      setStep('QUESTIONS');
    } catch (err: unknown) {
      setError((err as Error).message);
      setStep('UPLOAD');
    }
  };

  /** Step 2 -> Step 3: User approves questions, MARCOM synthesizes full Campaign Configuration */
  const approveAndAnalyze = async () => {
    setError(null);

    const missing = BRIEF_SECTIONS.filter((s) => s.required && !sections[s.key]?.trim());
    if (missing.length > 0) {
      setError(`Please complete all mandatory questions before proceeding: ${missing.map((s) => `"${s.prompt}"`).join(', ')}.`);
      return;
    }

    try {
      setStep('PROCESSING');
      setProcessingStage('ANALYZING');

      const links = linksText.split(/\s+/).map((l) => l.trim()).filter(Boolean);
      const textToAnalyze = composeBrief(
        projectName,
        sections,
        extractedText ? [{ name: sourceFileName || 'Uploaded Brief', text: extractedText }] : [],
        links.filter((l) => !isGoogleDoc(l)),
      );

      const analyzeRes = await authenticatedFetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ briefText: textToAnalyze }),
      });
      let analyzeData;
      try {
        analyzeData = await analyzeRes.json();
      } catch {
        throw new Error('Failed to analyze brief. The server returned an invalid response (possibly a rate limit).');
      }

      if (!analyzeRes.ok) {
        throw new Error(analyzeData.error || 'Failed to analyze brief.');
      }

      const analyzedBrief = analyzeData.structured_brief as StructuredBrief;
      setStructuredBrief({
        ...analyzedBrief,
        project: {
          ...analyzedBrief.project,
          name: projectName.trim() || analyzedBrief.project.name,
        },
      });
      setStep('REVIEW');
    } catch (err: unknown) {
      setError((err as Error).message);
      setStep('QUESTIONS');
    }
  };

  /** Step 3 Save: Persists final human-reviewed campaign configuration into PostgreSQL */
  const handleCreate = async (finalBrief: StructuredBrief) => {
    try {
      setError(null);
      setIsCreating(true);

      const res = await authenticatedFetch('/api/projects/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          structured_brief: finalBrief,
          original_brief: extractedText || composeBrief(projectName, sections, [], []),
          source_type: sourceFileId ? 'UPLOAD' : 'PASTE',
          source_name: sourceFileName ? `Structured Brief + ${sourceFileName}` : 'Structured Brief',
          source_file_id: sourceFileId || undefined,
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to create project');
      }

      handleReset();
      onSuccess(typeof data?.project?.project_id === 'string' ? data.project.project_id : undefined);
      onClose();
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#08080c]/90 backdrop-blur-md p-2 sm:p-6">
      <div className="w-full max-w-7xl h-[94vh] flex flex-col bg-[#0d0d12] border border-white/[0.08] rounded-2xl shadow-2xl overflow-hidden">
        
        {/* Header */}
        <div className="px-8 py-6 border-b border-white/[0.06] flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-xl font-semibold text-white/90">
              {step === 'REVIEW'
                ? 'Review campaign configuration'
                : step === 'QUESTIONS'
                  ? 'Review & refine project questions'
                  : 'Create your project brief'}
            </h2>
            <p className="text-[13px] text-white/40 mt-1 max-w-2xl">
              {step === 'REVIEW'
                ? 'Confirm the targets, search plan, and qualification criteria MARCOM will use for this campaign.'
                : step === 'QUESTIONS'
                  ? 'MARCOM has drafted answers from your brief. Review and edit any answers below, then approve them to configure your campaign.'
                  : 'Upload your brief document or notes to automatically answer the project questions, or choose to write them manually.'}
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/[0.05] text-white/40 hover:text-white transition-colors">
            ✕
          </button>
        </div>

        {/* Body */}
        <div className={`flex-1 min-h-0 relative ${step === 'REVIEW' ? 'flex flex-col' : 'overflow-y-auto p-4 sm:p-8'}`}>
          {error && (
            <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* STEP 1: UPLOAD BRIEF DOCUMENT */}
          {step === 'UPLOAD' && (
            <div className="max-w-2xl mx-auto flex flex-col gap-6 py-4">
              <div className="flex flex-col gap-2">
                <span className="text-xs uppercase tracking-wider font-semibold text-cyan-400">
                  Step 1 of 3 · Intake Document
                </span>
                <h3 className="text-2xl font-bold text-white/95">
                  Start with your project brief
                </h3>
                <p className="text-sm text-white/50 leading-relaxed">
                  Upload your pitch deck, one-pager, RFP, or brief document. MARCOM will read it and automatically answer the 4 mandatory questions for you to review and approve.
                </p>
              </div>

              {/* Upload Dropzone */}
              <div className="flex flex-col gap-4 p-6 rounded-2xl bg-white/[0.02] border border-white/[0.08] shadow-lg">
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
                  onChange={e => {
                    addFiles(Array.from(e.target.files ?? []));
                    e.target.value = '';
                  }}
                />

                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => fileInputRef.current?.click()}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      fileInputRef.current?.click();
                    }
                  }}
                  onDragOver={e => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!isDragging) setIsDragging(true);
                  }}
                  onDragLeave={e => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsDragging(false);
                  }}
                  onDrop={e => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsDragging(false);
                    addFiles(Array.from(e.dataTransfer.files ?? []));
                  }}
                  className={`flex flex-col items-center justify-center gap-3 p-8 rounded-xl border-2 border-dashed transition-all cursor-pointer text-center ${
                    isDragging
                      ? 'border-cyan-400 bg-cyan-500/[0.1] scale-[1.01]'
                      : 'border-white/[0.14] bg-white/[0.015] hover:bg-white/[0.035] hover:border-cyan-400/50'
                  }`}
                >
                  <div className="w-14 h-14 rounded-2xl bg-cyan-500/10 border border-cyan-500/25 flex items-center justify-center text-cyan-400 mb-1 shadow-inner">
                    <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="12" y1="18" x2="12" y2="12" />
                      <line x1="9" y1="15" x2="15" y2="15" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-base font-semibold text-white/90">
                      Drag &amp; drop your brief file here, or <span className="text-cyan-400 underline decoration-cyan-400/50 underline-offset-4">browse</span>
                    </p>
                    <p className="text-xs text-white/40 mt-1">
                      Supports PDF (.pdf), Word (.docx), TXT (.txt) and Markdown (.md) · Up to 15 MB
                    </p>
                  </div>
                </div>

                {files.length > 0 && (
                  <div className="flex items-center justify-between gap-3 p-3.5 rounded-xl bg-cyan-500/[0.08] border border-cyan-500/30 text-sm">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="px-2 py-0.5 rounded text-[11px] font-bold tracking-wider bg-cyan-400 text-[#0E1014]">
                        {getFileBadge(files[0].name)}
                      </span>
                      <span className="truncate font-semibold text-white/95">{files[0].name}</span>
                      <span className="text-white/40 shrink-0">({formatFileSize(files[0].size)})</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setFiles([])}
                      className="px-2.5 py-1 rounded-lg text-xs font-semibold text-white/60 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                )}

                {/* Optional Google Doc link or pasted text */}
                <div className="flex flex-col gap-3 pt-2 border-t border-white/[0.06]">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="brief-links-upload" className="text-xs font-medium text-white/60">
                      Or provide a public Google Docs link:
                    </label>
                    <input
                      id="brief-links-upload"
                      type="url"
                      placeholder="https://docs.google.com/document/d/... (publicly viewable)"
                      value={linksText}
                      onChange={e => setLinksText(e.target.value)}
                      className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl px-4 py-2.5 text-xs text-white/90 placeholder:text-white/30 focus:outline-none focus:border-cyan-400/60"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="brief-raw-text" className="text-xs font-medium text-white/60">
                      Or paste raw brief notes / scope directly:
                    </label>
                    <textarea
                      id="brief-raw-text"
                      rows={3}
                      placeholder="Paste brief text, requirements, or meeting notes here..."
                      value={rawBriefText}
                      onChange={e => setRawBriefText(e.target.value)}
                      className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl p-3 text-xs text-white/90 placeholder:text-white/30 focus:outline-none focus:border-cyan-400/60 resize-y"
                    />
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3">
                  <button
                    type="button"
                    onClick={() => setStep('QUESTIONS')}
                    className="text-xs text-white/45 hover:text-cyan-400 transition-colors underline underline-offset-4"
                  >
                    Or write answers manually without a document →
                  </button>

                  <PrimaryButton
                    onClick={extractAndPrefill}
                    disabled={files.length === 0 && !linksText.trim() && !rawBriefText.trim()}
                    className="w-full sm:w-auto"
                  >
                    Analyze Brief &amp; Answer Questions →
                  </PrimaryButton>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: REVIEW & EDIT THE 4 QUESTIONS (+ OPTIONAL CONSTRAINTS) */}
          {step === 'QUESTIONS' && (
            <div className="max-w-3xl mx-auto flex flex-col gap-6">
              {/* Attached brief notification banner if a document was uploaded */}
              {sourceFileName && (
                <div className="flex items-center justify-between gap-3 p-3.5 rounded-xl bg-cyan-500/[0.08] border border-cyan-500/25 text-xs">
                  <div className="flex items-center gap-2.5 text-cyan-300 font-medium truncate">
                    <span>📄</span>
                    <span className="truncate">Attached brief: <strong className="text-white">{sourceFileName}</strong></span>
                    <span className="text-cyan-400/70">· Questions auto-filled</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setStep('UPLOAD')}
                    className="px-2.5 py-1 rounded-lg text-xs font-semibold text-white/60 hover:text-white hover:bg-white/[0.06] transition-colors shrink-0"
                  >
                    Upload different file
                  </button>
                </div>
              )}

              <div className="flex flex-col gap-2">
                <label htmlFor="brief-project-name" className="text-[13px] font-medium text-white/60">
                  Project name <span className="text-white/30 font-normal">(optional)</span>
                </label>
                <input
                  id="brief-project-name"
                  type="text"
                  placeholder="MARCOM can suggest a name based on your brief if left blank..."
                  value={projectName}
                  onChange={e => setProjectName(e.target.value)}
                  className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-white/90 placeholder:text-white/30 focus:outline-none focus:border-cyan-400/50"
                />
              </div>

              {BRIEF_SECTIONS.map((s) => {
                const isFilled = Boolean(sections[s.key]?.trim());
                return (
                  <div
                    key={s.key}
                    className={`flex flex-col gap-2 p-5 rounded-2xl bg-white/[0.02] border transition-colors ${
                      s.required && !isFilled
                        ? 'border-white/[0.08]'
                        : 'border-white/[0.06]'
                    }`}
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-[11px] uppercase tracking-wider font-medium text-white/35">{s.title}</span>
                      {s.required ? (
                        isFilled ? (
                          <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-400">
                            <span>✓</span> Answered
                          </span>
                        ) : (
                          <span className="text-[11px] font-semibold text-cyan-400">
                            Required
                          </span>
                        )
                      ) : (
                        <span className="text-[11px] text-white/30 font-medium">Optional</span>
                      )}
                    </div>
                    <label htmlFor={`brief-${s.key}`} className="text-[15px] font-semibold text-white/90">
                      {s.prompt}
                    </label>
                    <p className="text-[12.5px] text-white/40 leading-relaxed">{s.helper}</p>
                    <textarea
                      id={`brief-${s.key}`}
                      placeholder={s.placeholder}
                      value={sections[s.key]}
                      onChange={(e) => {
                        if (error) setError(null);
                        setSections(prev => ({ ...prev, [s.key]: e.target.value }));
                      }}
                      rows={s.required ? 5 : 3}
                      className="mt-1 w-full min-h-[88px] bg-white/[0.03] border border-white/[0.08] rounded-xl p-4 text-sm text-white/80 placeholder:text-white/30 focus:outline-none focus:border-cyan-400/50 resize-y"
                    />
                  </div>
                );
              })}
            </div>
          )}

          {/* PROCESSING STATE */}
          {step === 'PROCESSING' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0d0d12]">
              <div className="w-16 h-16 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mb-6">
                <div className="w-6 h-6 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
              </div>
              <h3 className="text-lg font-medium text-white/90 mb-6">
                {processingStage === 'EXTRACTING'
                  ? 'Reading your brief document...'
                  : processingStage === 'PREFILLING'
                    ? 'Analyzing brief & drafting answers to intake questions...'
                    : 'Synthesising targets, qualification criteria & campaign configuration...'}
              </h3>
              <div className="flex flex-col gap-3 text-sm text-white/60 min-w-[320px]">
                <div className="flex items-center gap-3">
                  {processingStage !== 'EXTRACTING' ? (
                    <span className="text-green-400 font-bold">✓</span>
                  ) : (
                    <span className="w-3 h-3 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin ml-0.5" />
                  )}
                  <span className={processingStage !== 'EXTRACTING' ? 'text-white/80' : 'text-white/90 font-medium'}>
                    Document extraction &amp; normalisation
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  {processingStage === 'ANALYZING' ? (
                    <span className="text-green-400 font-bold">✓</span>
                  ) : processingStage === 'PREFILLING' ? (
                    <span className="w-3 h-3 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin ml-0.5" />
                  ) : (
                    <span className="text-white/20 ml-0.5">○</span>
                  )}
                  <span className={processingStage === 'PREFILLING' ? 'text-white/90 font-medium' : processingStage === 'ANALYZING' ? 'text-white/80' : 'text-white/40'}>
                    Answering the 4 core intake questions
                  </span>
                </div>
                <div className="flex items-center gap-3 text-white/30">
                  {processingStage === 'ANALYZING' ? (
                    <span className="w-3 h-3 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin ml-0.5" />
                  ) : (
                    <span className="ml-0.5">○</span>
                  )}
                  <span className={processingStage === 'ANALYZING' ? 'text-white/90 font-medium' : 'text-white/40'}>
                    Synthesising research &amp; outreach rules
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: CAMPAIGN CONFIGURATION REVIEW */}
          {step === 'REVIEW' && structuredBrief && (
            <CampaignConfigurationForm
              initialBrief={structuredBrief}
              originalBrief={extractedText || composeBrief(projectName, sections, [], [])}
              sourceFileId={sourceFileId}
              sourceFileName={sourceFileName}
              extractionWarnings={extractionWarnings}
              submitLabel="Save campaign"
              submitting={isCreating}
              serverError={error}
              onCancel={() => setStep('QUESTIONS')}
              onSubmit={handleCreate}
            />
          )}
        </div>

        {/* Footers for each step */}
        {step === 'UPLOAD' && (
          <div className="px-8 py-5 border-t border-white/[0.06] flex items-center justify-between gap-4 shrink-0 bg-white/[0.01]">
            <button
              type="button"
              onClick={() => setStep('QUESTIONS')}
              className="text-xs text-white/45 hover:text-white transition-colors"
            >
              Skip upload &amp; write manually →
            </button>
            <div className="flex items-center gap-3">
              <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
              <PrimaryButton
                onClick={extractAndPrefill}
                disabled={files.length === 0 && !linksText.trim() && !rawBriefText.trim()}
              >
                Analyze Brief &amp; Answer Questions →
              </PrimaryButton>
            </div>
          </div>
        )}

        {step === 'QUESTIONS' && (
          <div className="px-8 py-5 border-t border-white/[0.06] flex flex-wrap items-center justify-between gap-4 shrink-0 bg-white/[0.01]">
            <div className="text-xs">
              {!allMandatoryAnswered ? (
                <span className="text-amber-400/90 flex items-center gap-2 font-medium">
                  <span className="h-2 w-2 rounded-full bg-amber-400 shrink-0 animate-pulse" />
                  Answer all mandatory questions to continue ({missingSections.length} remaining)
                </span>
              ) : (
                <span className="text-emerald-400 flex items-center gap-2 font-medium">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
                  All mandatory questions answered
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <SecondaryButton onClick={() => setStep('UPLOAD')}>
                ← Back to upload
              </SecondaryButton>
              <PrimaryButton
                onClick={approveAndAnalyze}
                disabled={!allMandatoryAnswered}
                title={
                  !allMandatoryAnswered
                    ? `Please answer all mandatory questions (${missingSections.length} remaining)`
                    : 'Approve questions and generate campaign configuration'
                }
              >
                Approve Questions &amp; Configure Campaign →
              </PrimaryButton>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
