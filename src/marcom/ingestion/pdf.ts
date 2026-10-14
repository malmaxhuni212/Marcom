/**
 * PDF text extraction for brief intake.
 *
 *   PDF bytes -> validate -> pdf-parse (pdf.js) -> per-page text -> structure clean-up -> quality gate
 *
 * Every failure is classified so the UI can tell the user exactly what happened instead of a
 * generic "couldn't read file". We never report success unless usable text was extracted.
 * OCR is intentionally NOT performed: scanned/image-only PDFs are detected and reported.
 */
import { createRequire } from 'node:module';
import { assessTextQuality, stripRepeatedPageLines } from './normalize';

function getPdfParse(): PdfParseModule {
  // Use eval('require') so Webpack does not attempt to parse, rewrite, or bundle pdf-parse
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const req = eval('require') as NodeRequire;
  return req('pdf-parse') as unknown as PdfParseModule;
}

export const MAX_PDF_BYTES = 15 * 1024 * 1024; // 15 MB
export const MAX_PDF_PAGES = 150;
/** Pages with fewer meaningful characters than this are treated as having no text layer. */
const MIN_CHARS_PER_TEXT_PAGE = 25;

export type IngestionErrorCode =
  | 'EMPTY_FILE'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_TYPE'
  | 'PDF_INVALID'
  | 'PDF_PASSWORD_PROTECTED'
  | 'PDF_TOO_MANY_PAGES'
  | 'PDF_NO_TEXT_LAYER'
  | 'TEXT_CORRUPTED'
  | 'TEXT_TOO_SHORT'
  | 'EXTRACTION_FAILED';

export class IngestionError extends Error {
  constructor(
    public readonly code: IngestionErrorCode,
    message: string,
    public readonly status = 422,
  ) {
    super(message);
    this.name = 'IngestionError';
  }
}

export interface PdfExtraction {
  text: string;
  page_count: number;
  /** Pages (1-based) that had no selectable text — likely scanned images. */
  pages_without_text: number[];
  warnings: string[];
  title: string | null;
}

export function isPdfSignature(buffer: Buffer): boolean {
  // The header must appear within the first 1024 bytes per the PDF spec.
  return buffer.subarray(0, 1024).includes('%PDF-');
}

function meaningfulLength(text: string): number {
  return (text.match(/[\p{L}\p{N}]/gu) ?? []).length;
}

type PdfParseModule = typeof import('pdf-parse');

export async function extractPdfText(buffer: Buffer): Promise<PdfExtraction> {
  if (!buffer.length) throw new IngestionError('EMPTY_FILE', 'This PDF is empty (0 bytes).', 400);
  if (buffer.length > MAX_PDF_BYTES) {
    throw new IngestionError(
      'FILE_TOO_LARGE',
      `This PDF is ${(buffer.length / 1024 / 1024).toFixed(1)} MB. The maximum supported size is ${MAX_PDF_BYTES / 1024 / 1024} MB.`,
      413,
    );
  }
  if (!isPdfSignature(buffer)) {
    throw new IngestionError(
      'PDF_INVALID',
      "This file has a .pdf name but isn't a valid PDF document (it may be corrupted or a renamed file).",
    );
  }

  const { PDFParse, PasswordException, InvalidPDFException, FormatError } = getPdfParse();

  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    let pageCount = 0;
    let title: string | null = null;
    try {
      const info = await parser.getInfo();
      pageCount = info.total;
      const rawTitle = (info.info as Record<string, unknown> | undefined)?.Title;
      title = typeof rawTitle === 'string' && rawTitle.trim() ? rawTitle.trim() : null;
    } catch (e) {
      throw classifyPdfError(e, { PasswordException, InvalidPDFException, FormatError });
    }

    if (pageCount > MAX_PDF_PAGES) {
      throw new IngestionError(
        'PDF_TOO_MANY_PAGES',
        `This PDF has ${pageCount} pages. Briefs up to ${MAX_PDF_PAGES} pages are supported — please upload the relevant section.`,
      );
    }

    let result;
    try {
      // lineEnforce keeps visual line breaks so headings and list items stay on their own lines.
      result = await parser.getText({ lineEnforce: true, pageJoiner: '' });
    } catch (e) {
      throw classifyPdfError(e, { PasswordException, InvalidPDFException, FormatError });
    }

    const rawPages = result.pages.map((p) => p.text ?? '');
    const pagesWithoutText = rawPages
      .map((t, i) => (meaningfulLength(t) < MIN_CHARS_PER_TEXT_PAGE ? i + 1 : 0))
      .filter(Boolean);

    const totalMeaningful = rawPages.reduce((sum, t) => sum + meaningfulLength(t), 0);
    if (totalMeaningful < MIN_CHARS_PER_TEXT_PAGE || pagesWithoutText.length === rawPages.length) {
      throw new IngestionError(
        'PDF_NO_TEXT_LAYER',
        'This PDF contains no selectable text — it looks like a scanned document or images of pages. ' +
          'MARCOM does not run OCR yet. Export the brief as a text-based PDF or Word file, or paste the text directly.',
      );
    }

    const cleanedPages = stripRepeatedPageLines(rawPages);
    const text = cleanedPages.map((p) => p.trim()).filter(Boolean).join('\n\n');

    const quality = assessTextQuality(text);
    if (!quality.ok) {
      if (quality.reason === 'corrupted') {
        throw new IngestionError(
          'TEXT_CORRUPTED',
          'Text was found in this PDF but it is unreadable (the document uses a font encoding that cannot be decoded). ' +
            'Re-export the PDF from the original editor, or paste the text directly.',
        );
      }
      throw new IngestionError(
        'TEXT_TOO_SHORT',
        'This PDF contains too little text to be a project brief. Check you uploaded the right file.',
      );
    }

    const warnings: string[] = [];
    if (pagesWithoutText.length) {
      warnings.push(
        `${pagesWithoutText.length} of ${rawPages.length} pages (page ${pagesWithoutText.join(', ')}) had no selectable text — likely scanned images or diagrams. Their content was not analysed.`,
      );
    }

    return { text, page_count: pageCount || rawPages.length, pages_without_text: pagesWithoutText, warnings, title };
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

function classifyPdfError(
  error: unknown,
  types: Pick<PdfParseModule, 'PasswordException' | 'InvalidPDFException' | 'FormatError'>,
): IngestionError {
  if (error instanceof IngestionError) return error;
  const name = (error as Error)?.name ?? '';
  const message = (error as Error)?.message ?? '';
  if (error instanceof types.PasswordException || name === 'PasswordException' || /password/i.test(message)) {
    return new IngestionError(
      'PDF_PASSWORD_PROTECTED',
      'This PDF is password-protected. Remove the password (or export an unprotected copy) and upload it again.',
    );
  }
  if (
    error instanceof types.InvalidPDFException ||
    error instanceof types.FormatError ||
    /invalid pdf|invalid xref|bad xref|missing pdf|unexpected|corrupt|FormatError/i.test(`${name} ${message}`)
  ) {
    return new IngestionError(
      'PDF_INVALID',
      'This PDF appears to be corrupted or malformed and could not be opened. Try re-exporting it from the original application.',
    );
  }
  console.error('[ingestion] Unclassified PDF extraction error:', name, message);
  return new IngestionError(
    'EXTRACTION_FAILED',
    "MARCOM couldn't extract text from this PDF. You can paste the brief text directly instead.",
    500,
  );
}
