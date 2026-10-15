import { NextResponse } from 'next/server';
import mammoth from 'mammoth';
import { extractPdfText, IngestionError, MAX_PDF_BYTES } from '@/marcom/ingestion/pdf';
import { assessTextQuality, normaliseBriefText } from '@/marcom/ingestion/normalize';
import { saveSourceFile } from '@/marcom/ingestion/source-store';
import { authorizeApiRequest } from '@/auth/access';

// pdf.js and mammoth need the Node.js runtime (Buffer, fs).
export const runtime = 'nodejs';

const MAX_DOCX_BYTES = 15 * 1024 * 1024;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;

type FileKind = 'pdf' | 'docx' | 'txt' | 'md';

const DETECTED_MIME_TYPES: Record<FileKind, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
  md: 'text/markdown',
};

function detectKind(file: File): FileKind | null {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return 'pdf';
  if (name.endsWith('.docx') || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  if (name.endsWith('.md') || name.endsWith('.markdown') || file.type === 'text/markdown') return 'md';
  if (name.endsWith('.txt') || file.type === 'text/plain') return 'txt';
  return null;
}

function errorResponse(error: IngestionError) {
  return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
}

/** Turns any public Google Docs URL into its plain-text export URL. Only docs.google.com is allowed (prevents SSRF). */
function googleDocExportUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com') return null;
  const match = url.pathname.match(/\/document\/(?:u\/\d+\/)?d\/([\w-]{20,})/);
  return match ? `https://docs.google.com/document/d/${match[1]}/export?format=txt` : null;
}

function finalise(rawText: string, base: Record<string, unknown>, extraWarnings: string[] = []) {
  const normalised = normaliseBriefText(rawText);
  const quality = assessTextQuality(normalised.text);
  if (!quality.ok) {
    throw quality.reason === 'corrupted'
      ? new IngestionError('TEXT_CORRUPTED', 'The extracted text is unreadable or corrupted. Try re-exporting the document or paste the text directly.')
      : new IngestionError('TEXT_TOO_SHORT', "We couldn't find enough usable text in this document to analyse it as a brief.");
  }
  return {
    success: true as const,
    ...base,
    extracted_text: normalised.text,
    char_count: normalised.text.length,
    original_char_count: normalised.original_length,
    truncated: normalised.truncated,
    warnings: [...extraWarnings, ...normalised.warnings],
  };
}

export async function POST(req: Request) {
  const access = await authorizeApiRequest(req);
  if (!access.ok) return access.response;
  try {
    const formData = await req.formData();
    const url = formData.get('url');
    const textContent = formData.get('text');

    if (typeof textContent === 'string' && textContent.trim()) {
      return NextResponse.json(finalise(textContent, { source_type: 'text', source_name: 'Manual Input' }));
    }

    if (typeof url === 'string' && url.trim()) {
      const exportUrl = googleDocExportUrl(url);
      if (!exportUrl) {
        return NextResponse.json(
          { error: 'Enter a Google Docs link (https://docs.google.com/document/d/...).', code: 'UNSUPPORTED_TYPE' },
          { status: 400 },
        );
      }
      let text = '';
      try {
        const response = await fetch(exportUrl, { redirect: 'follow', signal: AbortSignal.timeout(15_000) });
        const contentType = response.headers.get('content-type') ?? '';
        // Private docs redirect to an HTML sign-in page instead of returning text/plain.
        if (response.ok && contentType.includes('text/plain')) text = await response.text();
      } catch {
        /* handled below */
      }
      if (!text.trim()) {
        return NextResponse.json(
          { error: "MARCOM couldn't access this document. Set sharing to \"Anyone with the link can view\" or paste the text directly.", code: 'EXTRACTION_FAILED' },
          { status: 400 },
        );
      }
      return NextResponse.json(finalise(text, { source_type: 'google_doc', source_name: 'Google Document', source_url: url.trim() }));
    }

    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file or text provided.', code: 'EMPTY_FILE' }, { status: 400 });
    }

    const kind = detectKind(file);
    if (!kind) {
      return NextResponse.json(
        { error: 'Unsupported file type. MARCOM supports PDF, Word (.docx), TXT and Markdown.', code: 'UNSUPPORTED_TYPE' },
        { status: 415 },
      );
    }
    if (file.size === 0) throw new IngestionError('EMPTY_FILE', 'This file is empty (0 bytes).', 400);
    const limit = kind === 'pdf' ? MAX_PDF_BYTES : kind === 'docx' ? MAX_DOCX_BYTES : MAX_TEXT_BYTES;
    if (file.size > limit) {
      throw new IngestionError(
        'FILE_TOO_LARGE',
        `This file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The maximum for ${kind.toUpperCase()} briefs is ${limit / 1024 / 1024} MB.`,
        413,
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    let rawText = '';
    let pageCount: number | undefined;
    const warnings: string[] = [];

    if (kind === 'pdf') {
      const pdf = await extractPdfText(buffer);
      rawText = pdf.text;
      pageCount = pdf.page_count;
      warnings.push(...pdf.warnings);
    } else if (kind === 'docx') {
      if (buffer.subarray(0, 2).toString('latin1') !== 'PK') {
        throw new IngestionError('EXTRACTION_FAILED', "This file isn't a valid Word (.docx) document. Older .doc files must be saved as .docx first.");
      }
      try {
        const result = await mammoth.extractRawText({ buffer });
        rawText = result.value;
      } catch {
        throw new IngestionError('EXTRACTION_FAILED', "We couldn't extract usable text from this Word document. It may be corrupted or password-protected.");
      }
    } else {
      if (buffer.includes(0)) {
        throw new IngestionError('TEXT_CORRUPTED', "This file doesn't look like plain text. Upload a .txt or .md file, or paste the text directly.");
      }
      rawText = buffer.toString('utf8');
    }

    // Only keep the original once extraction has succeeded; failures are not persisted.
    const detectedMimeType = DETECTED_MIME_TYPES[kind];
    const mimeType = file.type || detectedMimeType;
    const body = finalise(
      rawText,
      { source_type: kind, source_name: file.name, file_size: file.size, mime_type: mimeType, page_count: pageCount },
      warnings,
    );
    const stored = await saveSourceFile(buffer, file.name, {
      actor: access.actor,
      declaredMimeType: file.type || undefined,
      detectedMimeType,
    });
    return NextResponse.json({ ...body, source_file_id: stored.id });
  } catch (err) {
    if (err instanceof IngestionError) return errorResponse(err);
    console.error('Extraction error:', err);
    return NextResponse.json(
      { error: "We couldn't extract the brief. You can paste the text manually.", code: 'EXTRACTION_FAILED' },
      { status: 500 },
    );
  }
}
