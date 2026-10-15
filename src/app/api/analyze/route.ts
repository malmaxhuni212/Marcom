import { NextResponse } from 'next/server';
import { JsonFileMemoryStore } from '@/marcom/memory/store';
import { analyzeBrief } from '@/marcom/agents/brief-analyzer/analyzer';
import { GroqProvider } from '@/marcom/llm/groq-provider';
import { retrieveMemoryContext } from '@/marcom/memory/retrieval';
import { authorizeApiRequest } from '@/auth/access';

export async function POST(req: Request) {
  const access = await authorizeApiRequest(req);
  if (!access.ok) return access.response;
  try {
    const body = await req.json();
    const { briefText } = body;

    if (!briefText) {
      return NextResponse.json({ error: 'briefText is required' }, { status: 400 });
    }

    const store = new JsonFileMemoryStore();
    
    // We don't have a project yet, so we query just for Lunim context
    const memoryContext = retrieveMemoryContext({
      task: 'brief_analysis',
      project_id: 'new-project' // dummy id since it's not created yet
    }, store);

    let provider;
    try {
      provider = new GroqProvider();
    } catch (e) {
      console.error(e);
      return NextResponse.json({ error: 'LLM provider not configured. Check API Keys.' }, { status: 500 });
    }

    console.log('Analyzing brief...');
    const result = await analyzeBrief(briefText, provider, {
      memory: memoryContext,
      maxRepairs: 1,
    });

    if (!result.ok) {
      console.error(JSON.stringify({
        event: 'brief.parse.invalid_output',
        provider: result.provider,
        attempts: result.attempts,
        issueCodes: result.errors.map((issue) => issue.code),
      }));
      return NextResponse.json({
        error: 'The brief analyser returned an unusable response. Please try again.',
        code: 'AI_PROVIDER_INVALID_RESPONSE',
        retryable: true,
      }, { status: 502 });
    }

    return NextResponse.json({ 
      success: true, 
      structured_brief: result.brief,
      warnings: result.warnings
    });
  } catch (error) {
    console.error('Error analyzing brief:', error);
    const message = error instanceof Error ? error.message : 'Unknown analysis error';
    if (message === 'fetch failed' || error instanceof TypeError) {
      return NextResponse.json(
        {
          error: 'The brief analyser could not reach the configured AI provider. Check the local server network connection, then try again.',
          code: 'AI_PROVIDER_UNREACHABLE',
          retryable: true,
        },
        { status: 502 },
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
