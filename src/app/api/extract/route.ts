import { NextResponse } from 'next/server';
import mammoth from 'mammoth';

// Polyfill for pdf-parse canvas dependency in Node
if (typeof global !== 'undefined') {
  if (!global.DOMMatrix) (global as any).DOMMatrix = class DOMMatrix {};
  if (!global.Path2D) (global as any).Path2D = class Path2D {};
  if (!global.ImageData) (global as any).ImageData = class ImageData {};
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    
    // Check if it's a Google Doc URL or raw text submission instead of a file
    const url = formData.get('url') as string;
    const textContent = formData.get('text') as string;

    if (textContent) {
      return NextResponse.json({
        success: true,
        source_type: 'text',
        source_name: 'Manual Input',
        extracted_text: textContent
      });
    }

    if (url) {
      // Basic Google Doc text extraction (we will try fetching if it's public)
      // Note: A robust Google Doc integration requires OAuth.
      // For this implementation, we will attempt to fetch and parse HTML,
      // or instruct the user if it fails (access denied).
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Cannot access document');
        const html = await response.text();
        
        // Very rudimentary text extraction from public Google doc HTML
        // In reality, this needs the Google Drive API.
        const textMatch = html.match(/<script nonce=".*?">DOCS_modelChunk = \[\{"s":"(.*?)"\}\];/);
        let extractedText = '';
        if (textMatch && textMatch[1]) {
          // Google Docs often stores text chunks encoded in JS
          extractedText = textMatch[1].replace(/\\n/g, '\n').replace(/\\u([0-9a-fA-F]{4})/g, (m, c) => String.fromCharCode(parseInt(c, 16)));
        } else {
          // Fallback: strip html tags
          extractedText = html.replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim();
        }

        if (!extractedText || extractedText.length < 50) {
           return NextResponse.json({ 
             error: "MARCOM couldn't access this document. Connect Google Drive or make the document accessible."
           }, { status: 400 });
        }

        return NextResponse.json({
          success: true,
          source_type: 'google_doc',
          source_name: 'Google Document',
          source_url: url,
          extracted_text: extractedText
        });
      } catch (err) {
        return NextResponse.json({ 
          error: "MARCOM couldn't access this document. Connect Google Drive or make the document accessible." 
        }, { status: 400 });
      }
    }

    const file = formData.get('file') as File;
    if (!file) {
      return NextResponse.json({ error: 'No file or text provided' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    let extractedText = '';

    if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const pdfParse = require('pdf-parse');
        const data = await pdfParse(buffer);
        extractedText = data.text;
      } catch (e) {
        console.error('PDF Parse Error:', e);
        return NextResponse.json({ error: "We couldn't extract usable text from this document." }, { status: 400 });
      }
    } else if (
      file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || 
      file.name.endsWith('.docx')
    ) {
      try {
        const result = await mammoth.extractRawText({ buffer });
        extractedText = result.value;
      } catch (e) {
        return NextResponse.json({ error: "We couldn't extract usable text from this DOCX." }, { status: 400 });
      }
    } else if (file.type === 'text/plain' || file.type === 'text/markdown' || file.name.endsWith('.txt') || file.name.endsWith('.md')) {
      extractedText = buffer.toString('utf8');
    } else {
      return NextResponse.json({ error: "MARCOM currently supports PDF, DOCX, TXT and Markdown." }, { status: 400 });
    }

    const cleanedText = extractedText.trim();
    if (!cleanedText) {
      return NextResponse.json({ error: "We couldn't find usable text in this file." }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      source_type: file.name.split('.').pop()?.toLowerCase() || 'file',
      source_name: file.name,
      file_size: file.size,
      mime_type: file.type,
      extracted_text: cleanedText
    });

  } catch (err) {
    console.error('Extraction error:', err);
    return NextResponse.json({ error: "We couldn't extract the brief. You can paste the text manually." }, { status: 500 });
  }
}
