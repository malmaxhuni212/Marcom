import { NextResponse } from 'next/server';
import { JsonFileMemoryStore } from '@/marcom/memory/store';
import { analyzeBrief } from '@/marcom/agents/brief-analyzer/analyzer';
import { GroqProvider } from '@/marcom/llm/groq-provider';
import { retrieveMemoryContext } from '@/marcom/memory/retrieval';
import { authorizeApiRequest } from '@/auth/access';
import { setGuestCookie } from '@/auth/guest';

export async function POST(req: Request) {
  const access = await authorizeApiRequest(req, { allowGuest: true });
  if (!access.ok) return access.response;

  const withGuestCookie = (res: NextResponse) => {
    if (access.isGuest && access.guest) {
      setGuestCookie(res, access.guest.token);
    }
    return res;
  };

  try {
    const body = await req.json();
    const { briefText } = body;

    if (!briefText) {
      return withGuestCookie(NextResponse.json({ error: 'briefText is required' }, { status: 400 }));
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
      return withGuestCookie(
        NextResponse.json({ error: 'LLM provider not configured. Check API Keys.' }, { status: 500 }),
      );
    }

    if (body.mode === 'prefill') {
      const system = `You are MARCOM's expert Brief Synthesis Assistant.
Your task is to analyze the provided human project brief or uploaded document, and extract clear, professional, comprehensive answers to these 4 core intake questions, plus a suggested project name and optional constraints.

You must return a valid JSON object matching this exact schema:
{
  "project_name": "Short, clear project name (e.g. 'Maya Book Awards 2026', 'FlowPilot Automation')",
  "overview": "Detailed answer for 'What is this project about?': Describe the company, product, initiative or situation and important background.",
  "goals": "Detailed answer for 'What are you trying to achieve?': Explain the problems being solved, the goals being pursued, and desired outcomes.",
  "work": "Detailed answer for 'What do you need MARCOM to help you with?': Describe the work to carry out, such as research, finding contacts, partnerships, outreach, or campaigns.",
  "audience": "Detailed answer for 'Who or what should MARCOM focus on?': Describe the target audience, people, organisations, industries, locations, or communities to focus on.",
  "constraints": "Important instructions, budget, deadlines, requirements, restrictions or limitations mentioned (or empty string if none mentioned)."
}

Write natural, direct, specific answers derived directly from the brief. Return ONLY valid JSON.`;

      const user = `Here is the project brief:\n\n<<<BRIEF\n${briefText}\nBRIEF>>>\n\nAnalyze this brief and output ONLY the JSON object with the answers to the 4 questions, project name, and constraints.`;

      const raw = await provider.complete({
        system,
        user,
        responseSchema: {
          type: 'object',
          properties: {
            project_name: { type: 'string' },
            overview: { type: 'string' },
            goals: { type: 'string' },
            work: { type: 'string' },
            audience: { type: 'string' },
            constraints: { type: 'string' },
          },
          required: ['project_name', 'overview', 'goals', 'work', 'audience', 'constraints'],
        },
      });

      const { extractJson } = await import('@/marcom/llm/provider');
      const data = extractJson(raw) as Record<string, string>;

      return withGuestCookie(
        NextResponse.json({
          success: true,
          project_name: typeof data.project_name === 'string' ? data.project_name.trim() : '',
          sections: {
            overview: typeof data.overview === 'string' ? data.overview.trim() : '',
            goals: typeof data.goals === 'string' ? data.goals.trim() : '',
            work: typeof data.work === 'string' ? data.work.trim() : '',
            audience: typeof data.audience === 'string' ? data.audience.trim() : '',
            constraints: typeof data.constraints === 'string' ? data.constraints.trim() : '',
          },
        }),
      );
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
      return withGuestCookie(
        NextResponse.json({
          error: 'The brief analyser returned an unusable response. Please try again.',
          code: 'AI_PROVIDER_INVALID_RESPONSE',
          retryable: true,
        }, { status: 502 }),
      );
    }

    return withGuestCookie(
      NextResponse.json({ 
        success: true, 
        structured_brief: result.brief,
        warnings: result.warnings
      }),
    );
  } catch (error) {
    console.error('Error analyzing brief:', error);
    const message = error instanceof Error ? error.message : 'Unknown analysis error';
    if (message === 'fetch failed' || error instanceof TypeError) {
      return withGuestCookie(
        NextResponse.json(
          {
            error: 'The brief analyser could not reach the configured AI provider. Check the local server network connection, then try again.',
            code: 'AI_PROVIDER_UNREACHABLE',
            retryable: true,
          },
          { status: 502 },
        ),
      );
    }
    return withGuestCookie(NextResponse.json({ error: message }, { status: 500 }));
  }
}
