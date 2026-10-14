import { NextResponse } from 'next/server';
import { readSourceFile, readSourceMeta } from '@/marcom/ingestion/source-store';

export const runtime = 'nodejs';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(req: Request, context: RouteContext) {
  const { id } = await context.params;
  const url = new URL(req.url);

  // If metadata only is requested:
  if (url.searchParams.get('info') === 'true' || url.searchParams.get('meta') === 'true') {
    const meta = await readSourceMeta(id);
    if (!meta) {
      return NextResponse.json({ error: 'Source file not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, meta });
  }

  const result = await readSourceFile(id);
  if (!result) {
    return NextResponse.json({ error: 'Source file not found' }, { status: 404 });
  }

  const { meta, data } = result;
  const isDownload = url.searchParams.get('download') === '1' || url.searchParams.get('download') === 'true';
  const dispositionType = isDownload ? 'attachment' : 'inline';

  return new NextResponse(data as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': meta.mime_type || 'application/octet-stream',
      'Content-Disposition': `${dispositionType}; filename="${encodeURIComponent(meta.original_filename)}"`,
      'Content-Length': meta.size_bytes.toString(),
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
