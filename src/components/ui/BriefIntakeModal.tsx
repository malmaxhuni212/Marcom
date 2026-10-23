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
  onSuccess: () => void;
}

type Step = 'INPUT' | 'PROCESSING' | 'REVIEW';
type SectionKey = 'overview' | 'goals' | 'audience' | 'work' | 'constraints' | 'additional';

interface BriefSection {
  key: SectionKey;
  title: string;
  prompt: string;
  helper: string;
  placeholder: string;
  required?: boolean;
}

/** The six general-purpose brief sections. Titles are used as labels in the text sent to the Brief Analyzer. */
const BRIEF_SECTIONS: BriefSection[] = [
  { key: 'overview', title: 'Project Overview', prompt: 'What is this project about?', helper: 'Describe the company, product, initiative or situation and provide any important background.', placeholder: 'Describe your project here...', required: true },
  { key: 'goals', title: 'Goals and Objectives', prompt: 'What are you trying to achieve?', helper: "Explain the problems you're solving, the goals you're pursuing and the outcomes you want.", placeholder: 'Explain your main goals and desired outcomes...', required: true },
  { key: 'audience', title: 'Target Audience and Focus', prompt: 'Who or what should MARCOM focus on?', helper: 'Describe relevant people, organisations, industries, locations, communities or other areas of focus.', placeholder: 'Describe your target audience or area of focus...' },
  { key: 'work', title: 'What Needs to Be Done?', prompt: 'What do you need MARCOM to help with?', helper: 'Describe the work you need, such as research, finding contacts, partnerships, outreach, campaigns, content or other activities.', placeholder: 'Describe the work you want to carry out...' },
  { key: 'constraints', title: 'Important Context and Constraints', prompt: 'What else should MARCOM know?', helper: 'Include existing plans, budget, deadlines, resources, requirements, restrictions or anything MARCOM should avoid.', placeholder: 'Add important instructions or limitations...' },
  { key: 'additional', title: 'Additional Information', prompt: 'Is there anything else that could be useful?', helper: 'Add any additional context, links or information that may help MARCOM understand the project.', placeholder: 'Add anything else that might be useful...' },
];

const EMPTY_SECTIONS: Record<SectionKey, string> = { overview: '', goals: '', audience: '', work: '', constraints: '', additional: '' };

/** Combines the user's answers and any supporting material into one clearly labelled brief. Answers are preserved verbatim. */
function composeBrief(
  name: string,
  sections: Record<SectionKey, string>,
  documents: { name: string; text: string }[],
  links: string[],
): string {
  const parts = [
    'MARCOM STRUCTURED PROJECT BRIEF',
    "The user answered the sections below in their own words. These answers are the primary source of truth.",
    `Project name: ${name.trim() || '(not provided - suggest one from the brief)'}`,
    ...BRIEF_SECTIONS.map((s) => `## ${s.title}\n${sections[s.key].trim() || '(not provided)'}`),
  ];
  if (documents.length || links.length) {
    parts.push('=== SUPPORTING MATERIAL (secondary; must not override the answers above - report any contradictions as conflicts) ===');
    for (const doc of documents) parts.push(`### Supporting document: ${doc.name}\n${doc.text}`);
    if (links.length) parts.push(`### Reference links\n${links.map((l) => `- ${l}`).join('\n')}`);
  }
  return parts.join('\n\n');
}

const isGoogleDoc = (link: string) => /^https:\/\/docs\.google\.com\/document\//i.test(link);

export default function BriefIntakeModal({ isOpen, onClose, onSuccess }: BriefIntakeModalProps) {
  const [step, setStep] = useState<Step>('INPUT');

  // Input state
  const [sections, setSections] = useState<Record<SectionKey, string>>(EMPTY_SECTIONS);
  const [projectName, setProjectName] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [linksText, setLinksText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Processing & metadata state
  const [extractedText, setExtractedText] = useState('');
  const [structuredBrief, setStructuredBrief] = useState<StructuredBrief | null>(null);
  const [sourceFileId, setSourceFileId] = useState<string | null>(null);
  const [sourceFileName, setSourceFileName] = useState<string | null>(null);
  const [extractionWarnings, setExtractionWarnings] = useState<string[]>([]);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [processingStage, setProcessingStage] = useState<'EXTRACTING' | 'ANALYZING'>('EXTRACTING');
  
  // Create Project state
  const [isCreating, setIsCreating] = useState(false);

  if (!isOpen) return null;

  const handleReset = () => {
    setStep('INPUT');
    setSections(EMPTY_SECTIONS);
    setProjectName('');
    setFiles([]);
    setLinksText('');
    setError(null);
    setStructuredBrief(null);
    setSourceFileId(null);
    setSourceFileName(null);
    setExtractionWarnings([]);
    setPageCount(null);
    setFileSize(null);
  };

  /** Runs one /api/extract call and returns its JSON. Throws a labelled error on failure. */
  const extractSupporting = async (formData: FormData, label: string) => {
    const res = await authenticatedFetch('/api/extract', { method: 'POST', body: formData });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) throw new Error(`Could not read supporting material "${label}": ${data?.error || 'invalid server response'}. Remove it or try again.`);
    return data;
  };

  // User input is never cleared on failure: every error path returns to the INPUT step with state intact.
  const extractAndAnalyze = async () => {
    setError(null);

    try {
      if (!sections.overview.trim() || !sections.goals.trim()) {
        throw new Error('Please complete the required sections: Project Overview and Goals and Objectives.');
      }

      const links = linksText.split(/\s+/).map((l) => l.trim()).filter(Boolean);
      setStep('PROCESSING');
      setProcessingStage(files.length || links.some(isGoogleDoc) ? 'EXTRACTING' : 'ANALYZING');

      // 1. Supporting material (optional, reuses existing extraction + source storage)
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
          setPageCount(data.page_count ?? null);
          setFileSize(data.file_size ?? null);
        }
      }
      for (const link of links.filter(isGoogleDoc)) {
        const fd = new FormData();
        fd.append('url', link);
        const data = await extractSupporting(fd, link);
        documents.push({ name: link, text: data.extracted_text });
      }

      setSourceFileId(firstFileId);
      setSourceFileName(firstFileName);
      setExtractionWarnings(warnings);

      const textToAnalyze = composeBrief(projectName, sections, documents, links.filter((l) => !isGoogleDoc(l)));
      setExtractedText(textToAnalyze);
      setProcessingStage('ANALYZING');

      // 2. Analyze
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
      setStep('INPUT');
    }
  };

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
          original_brief: extractedText,
          source_type: sourceFileId ? 'UPLOAD' : 'PASTE',
          source_name: sourceFileName ? `Structured Brief + ${sourceFileName}` : 'Structured Brief',
          source_file_id: sourceFileId || undefined,
        }),
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create project');
      }

      handleReset();
      onSuccess();
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
            <h2 className="text-xl font-semibold text-white/90">{step === 'REVIEW' ? 'Review campaign configuration' : 'Create your project brief'}</h2>
            <p className="text-[13px] text-white/40 mt-1 max-w-2xl">
              {step === 'REVIEW'
                ? 'Confirm the information MARCOM will use to prepare campaign research.'
                : "Tell MARCOM what you're working on, what you want to achieve and what it needs to know. Write naturally; you don't need to fill in every section."}
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

          {step === 'INPUT' && (
            <div className="max-w-3xl mx-auto flex flex-col gap-6">
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
                  className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-white/90 placeholder:text-white/30 focus:outline-none focus:border-accent-blue/50"
                />
              </div>

              {BRIEF_SECTIONS.map((s) => (
                <div key={s.key} className="flex flex-col gap-2 p-5 rounded-2xl bg-white/[0.02] border border-white/[0.06]">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-[11px] uppercase tracking-wider font-medium text-white/35">{s.title}</span>
                    <span className={`text-[11px] ${s.required ? 'text-cyan-400/80' : 'text-white/25'}`}>{s.required ? 'Required' : 'Optional'}</span>
                  </div>
                  <label htmlFor={`brief-${s.key}`} className="text-[15px] font-semibold text-white/90">{s.prompt}</label>
                  <p className="text-[12.5px] text-white/40 leading-relaxed">{s.helper}</p>
                  <textarea
                    id={`brief-${s.key}`}
                    placeholder={s.placeholder}
                    value={sections[s.key]}
                    onChange={e => setSections(prev => ({ ...prev, [s.key]: e.target.value }))}
                    rows={s.required ? 5 : 3}
                    className="mt-1 w-full min-h-[88px] bg-white/[0.03] border border-white/[0.08] rounded-xl p-4 text-sm text-white/80 placeholder:text-white/30 focus:outline-none focus:border-accent-blue/50 resize-y"
                  />
                </div>
              ))}

              {/* Secondary: supporting documents and links */}
              <details className="group rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.01]" open={files.length > 0 || !!linksText}>
                <summary className="cursor-pointer list-none px-5 py-4 flex items-center justify-between text-[13px] text-white/60 hover:text-white/80">
                  <span>Supporting documents and links <span className="text-white/30">(optional)</span></span>
                  <span className="text-white/30 group-open:rotate-45 transition-transform text-lg leading-none">+</span>
                </summary>
                <div className="px-5 pb-5 flex flex-col gap-4">
                  <p className="text-[12px] text-white/35">These supplement your answers above. If they conflict with your answers, MARCOM will flag it for review rather than overriding you.</p>
                  <div>
                    <input
                      type="file"
                      ref={fileInputRef}
                      className="hidden"
                      multiple
                      accept=".pdf,.docx,.txt,.md"
                      onChange={e => {
                        const picked = Array.from(e.target.files ?? []);
                        setFiles(prev => [...prev, ...picked.filter(p => !prev.some(f => f.name === p.name && f.size === p.size))]);
                        e.target.value = '';
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="px-4 py-2 rounded-lg text-[13px] bg-white/[0.04] border border-white/[0.08] text-white/70 hover:bg-white/[0.07] transition-colors"
                    >
                      Attach documents
                    </button>
                    <span className="ml-3 text-[11px] text-white/30">PDF, Word (.docx), TXT or Markdown</span>
                    {files.length > 0 && (
                      <ul className="mt-3 flex flex-col gap-1.5">
                        {files.map((f, i) => (
                          <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-white/[0.03] text-[12.5px] text-white/70">
                            <span className="truncate">{f.name} <span className="text-white/30">· {(f.size / 1024 / 1024).toFixed(2)} MB</span></span>
                            <button type="button" onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))} className="text-white/30 hover:text-red-400" aria-label={`Remove ${f.name}`}>✕</button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    <label htmlFor="brief-links" className="text-[12.5px] text-white/50">Reference links (one per line). Public Google Docs are imported automatically.</label>
                    <textarea
                      id="brief-links"
                      rows={2}
                      placeholder="https://..."
                      value={linksText}
                      onChange={e => setLinksText(e.target.value)}
                      className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl p-3 text-sm text-white/80 placeholder:text-white/30 focus:outline-none focus:border-accent-blue/50 resize-y"
                    />
                  </div>
                </div>
              </details>
            </div>
          )}

          {step === 'PROCESSING' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0d0d12]">
              <div className="w-16 h-16 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mb-6">
                <div className="w-6 h-6 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
              </div>
              <h3 className="text-lg font-medium text-white/90 mb-6">
                {processingStage === 'EXTRACTING'
                  ? 'Reading your supporting documents and links...'
                  : 'Analysing brief & structuring campaign requirements...'}
              </h3>
              <div className="flex flex-col gap-3 text-sm text-white/60 min-w-[300px]">
                <div className="flex items-center gap-3">
                  {processingStage === 'ANALYZING' ? (
                    <span className="text-green-400 font-bold">✓</span>
                  ) : (
                    <span className="w-3 h-3 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin ml-0.5" />
                  )}
                  <span className={processingStage === 'ANALYZING' ? 'text-white/80' : 'text-white/90 font-medium'}>
                    Document extraction & normalisation
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  {processingStage === 'ANALYZING' ? (
                    <span className="w-3 h-3 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin ml-0.5" />
                  ) : (
                    <span className="text-white/20 ml-0.5">○</span>
                  )}
                  <span className={processingStage === 'ANALYZING' ? 'text-white/90 font-medium' : 'text-white/40'}>
                    Identifying targets, qualifications & constraints
                  </span>
                </div>
                <div className="flex items-center gap-3 text-white/30">
                  <span className="ml-0.5">○</span>
                  <span>Synthesising research & outreach rules</span>
                </div>
              </div>
            </div>
          )}

          {step === 'REVIEW' && structuredBrief && (
            <CampaignConfigurationForm
              initialBrief={structuredBrief}
              originalBrief={extractedText}
              sourceFileId={sourceFileId}
              sourceFileName={sourceFileName}
              extractionWarnings={extractionWarnings}
              submitLabel="Save campaign"
              submitting={isCreating}
              serverError={error}
              onCancel={() => setStep('INPUT')}
              onSubmit={handleCreate}
            />
          )}
        </div>

        {/* Footer */}
        {step === 'INPUT' && <div className="px-8 py-5 border-t border-white/[0.06] flex items-center justify-end gap-3 shrink-0 bg-white/[0.01]">
          {step === 'INPUT' && (
            <>
              <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
              <PrimaryButton onClick={extractAndAnalyze}>Analyze Brief</PrimaryButton>
            </>
          )}
        </div>}

      </div>
    </div>
  );
}
