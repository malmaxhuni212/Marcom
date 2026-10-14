'use client';

import { useState, useRef } from 'react';
import PrimaryButton from './PrimaryButton';
import SecondaryButton from './SecondaryButton';
import type { StructuredBrief } from '@/marcom/schemas/structured-brief';
import CampaignConfigurationForm from '@/components/campaign/CampaignConfigurationForm';

interface BriefIntakeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

type Step = 'INPUT' | 'PROCESSING' | 'REVIEW';
type InputMode = 'PASTE' | 'UPLOAD' | 'URL';

export default function BriefIntakeModal({ isOpen, onClose, onSuccess }: BriefIntakeModalProps) {
  const [step, setStep] = useState<Step>('INPUT');
  const [inputMode, setInputMode] = useState<InputMode>('PASTE');
  
  // Input state
  const [briefText, setBriefText] = useState('');
  const [projectName, setProjectName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
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
    setBriefText('');
    setProjectName('');
    setFile(null);
    setUrl('');
    setError(null);
    setStructuredBrief(null);
    setSourceFileId(null);
    setSourceFileName(null);
    setExtractionWarnings([]);
    setPageCount(null);
    setFileSize(null);
  };

  const extractAndAnalyze = async () => {
    setError(null);
    
    try {
      const formData = new FormData();
      if (inputMode === 'PASTE') {
        if (!briefText.trim()) throw new Error('Please enter your brief.');
        formData.append('text', briefText);
      } else if (inputMode === 'UPLOAD') {
        if (!file) throw new Error('Please select a file.');
        formData.append('file', file);
      } else if (inputMode === 'URL') {
        if (!url.trim()) throw new Error('Please enter a Google Doc URL.');
        formData.append('url', url);
      }

      setStep('PROCESSING');
      setProcessingStage('EXTRACTING');

      let textToAnalyze = '';

      if (inputMode === 'PASTE') {
        textToAnalyze = briefText;
        setSourceFileId(null);
        setSourceFileName(null);
        setExtractionWarnings([]);
      } else {
        const extractRes = await fetch('/api/extract', {
          method: 'POST',
          body: formData,
        });
        
        let extractData;
        try {
          extractData = await extractRes.json();
        } catch {
          throw new Error('Failed to extract file. The server returned an invalid response.');
        }

        if (!extractRes.ok) throw new Error(extractData.error || 'Failed to extract brief.');
        textToAnalyze = extractData.extracted_text;
        setSourceFileId(extractData.source_file_id || null);
        setSourceFileName(extractData.source_name || file?.name || null);
        setExtractionWarnings(extractData.warnings || []);
        setPageCount(extractData.page_count ?? null);
        setFileSize(extractData.file_size ?? null);
      }
      
      setExtractedText(textToAnalyze);
      setProcessingStage('ANALYZING');

      // 2. Analyze
      const analyzeRes = await fetch('/api/analyze', {
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

      const res = await fetch('/api/projects/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          structured_brief: finalBrief,
          original_brief: extractedText,
          source_type: inputMode,
          source_name: sourceFileName || file?.name || 'Manual Input',
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#08080c]/90 backdrop-blur-md p-6">
      <div className="w-full max-w-7xl h-[94vh] flex flex-col bg-[#0d0d12] border border-white/[0.08] rounded-2xl shadow-2xl overflow-hidden">
        
        {/* Header */}
        <div className="px-8 py-6 border-b border-white/[0.06] flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-xl font-semibold text-white/90">{step === 'REVIEW' ? 'Review campaign configuration' : 'Create a new project'}</h2>
            <p className="text-[13px] text-white/40 mt-1">
              {step === 'REVIEW'
                ? 'Confirm the information MARCOM will use to prepare campaign research.'
                : 'Give MARCOM the context for what you are trying to achieve.'}
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/[0.05] text-white/40 hover:text-white transition-colors">
            ✕
          </button>
        </div>

        {/* Body */}
        <div className={`flex-1 min-h-0 relative ${step === 'REVIEW' ? 'flex flex-col' : 'overflow-y-auto p-8'}`}>
          {error && (
            <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {error}
            </div>
          )}

          {step === 'INPUT' && (
            <div className="max-w-3xl mx-auto flex flex-col gap-8">
              <div className="flex flex-col gap-2">
                <label className="text-[13px] font-medium text-white/60">Optional Project Name</label>
                <input
                  type="text"
                  placeholder="MARCOM will infer a project name from the brief if left blank..."
                  value={projectName}
                  onChange={e => setProjectName(e.target.value)}
                  className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-white/90 placeholder:text-white/30 focus:outline-none focus:border-accent-blue/50"
                />
              </div>

              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-2 p-1 bg-white/[0.03] border border-white/[0.06] rounded-xl w-fit">
                  {(['PASTE', 'UPLOAD', 'URL'] as InputMode[]).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setInputMode(mode)}
                      className={`px-4 py-2 rounded-lg text-[13px] font-medium transition-all ${inputMode === mode ? 'bg-white/[0.08] text-white/90 shadow-sm' : 'text-white/40 hover:text-white/70'}`}
                    >
                      {mode === 'PASTE' ? 'Paste Text' : mode === 'UPLOAD' ? 'Upload File' : 'Google Doc'}
                    </button>
                  ))}
                </div>

                {inputMode === 'PASTE' && (
                  <textarea
                    placeholder="Paste your project brief, strategy document, campaign notes, client requirements, research brief, or any other context here..."
                    value={briefText}
                    onChange={e => setBriefText(e.target.value)}
                    className="w-full h-64 bg-white/[0.03] border border-white/[0.08] rounded-xl p-5 text-sm text-white/80 placeholder:text-white/30 focus:outline-none focus:border-accent-blue/50 resize-none"
                  />
                )}

                {inputMode === 'UPLOAD' && (
                  <div 
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full h-64 border-2 border-dashed border-white/[0.1] rounded-xl flex flex-col items-center justify-center gap-3 cursor-pointer hover:bg-white/[0.02] hover:border-white/[0.2] transition-colors"
                  >
                    <input 
                      type="file" 
                      ref={fileInputRef} 
                      className="hidden" 
                      accept=".pdf,.docx,.txt,.md"
                      onChange={e => e.target.files && setFile(e.target.files[0])}
                    />
                    <div className="w-12 h-12 rounded-full bg-white/[0.05] flex items-center justify-center">
                      <svg className="w-5 h-5 text-white/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                      </svg>
                    </div>
                    {file ? (
                      <div className="text-center px-4">
                        <p className="text-sm font-medium text-white/90">{file.name}</p>
                        <p className="text-xs text-white/40 mt-1">{(file.size / 1024 / 1024).toFixed(2)} MB • Ready to analyze</p>
                      </div>
                    ) : (
                      <div className="text-center px-6">
                        <p className="text-sm font-medium text-white/90">Drop your brief here, or click to browse</p>
                        <p className="text-xs text-white/40 mt-1">PDF, Word (.docx), TXT or Markdown (up to 15 MB)</p>
                        <p className="text-[11px] text-white/30 mt-1.5">Note: PDFs must contain selectable text (scanned / image-only documents require OCR)</p>
                      </div>
                    )}
                  </div>
                )}

                {inputMode === 'URL' && (
                  <div className="w-full h-64 flex flex-col justify-center">
                    <label className="text-[13px] font-medium text-white/60 mb-2">Google Docs URL</label>
                    <input
                      type="url"
                      placeholder="https://docs.google.com/document/d/..."
                      value={url}
                      onChange={e => setUrl(e.target.value)}
                      className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-white/90 placeholder:text-white/30 focus:outline-none focus:border-accent-blue/50"
                    />
                    <p className="text-xs text-white/40 mt-3">Document must be publicly accessible or shared with MARCOM.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 'PROCESSING' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0d0d12]">
              <div className="w-16 h-16 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mb-6">
                <div className="w-6 h-6 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
              </div>
              <h3 className="text-lg font-medium text-white/90 mb-6">
                {processingStage === 'EXTRACTING'
                  ? (inputMode === 'UPLOAD' ? `Extracting text from ${file?.name ?? 'document'}...` : inputMode === 'URL' ? 'Fetching Google Doc content...' : 'Normalising brief text...')
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
