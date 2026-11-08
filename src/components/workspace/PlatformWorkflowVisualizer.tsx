'use client';

import { Icon, serif } from './ui';

interface WorkflowStep {
  step: string;
  badge: string;
  badgeColor: string;
  title: string;
  subtitle: string;
  description: string;
  features: string[];
  icon: 'edit' | 'list' | 'search' | 'sparkle' | 'send';
  accent: string;
  bgGlow: string;
}

const WORKFLOW_STEPS: WorkflowStep[] = [
  {
    step: '01',
    badge: 'Input',
    badgeColor: 'border-[#4A3B17] bg-[#1F1A10] text-[#F2C36B]',
    title: 'Campaign Brief',
    subtitle: 'AI Brief Analyzer',
    description:
      'Upload a PDF or Word document, or paste raw notes. The Brief Analyzer extracts core goals, project parameters, key themes, and value propositions.',
    features: ['PDF / DOCX / Text upload', 'Structured goal extraction', 'Auto-detected propositions'],
    icon: 'edit',
    accent: '#F2C36B',
    bgGlow: 'rgba(242, 195, 107, 0.08)',
  },
  {
    step: '02',
    badge: 'Audiences',
    badgeColor: 'border-[#2E6B75] bg-[#12313A] text-[#5ED3DF]',
    title: 'Target Categories',
    subtitle: 'Audience Matrix',
    description:
      'Structures distinct target categories (e.g. Authors, Sponsors, Press, Partners) with custom search criteria, angle rules, and tailored benefits for each segment.',
    features: ['Multi-category definition', 'Segment-specific benefits', 'Audience parameters'],
    icon: 'list',
    accent: '#5ED3DF',
    bgGlow: 'rgba(94, 211, 223, 0.08)',
  },
  {
    step: '03',
    badge: 'Research',
    badgeColor: 'border-[#1F4A33] bg-[#10261B] text-[#5BD69A]',
    title: 'Prospect Research',
    subtitle: 'Research Agent',
    description:
      'Autonomous web search finds matching people and organisations, verifies real contact routes (emails, LinkedIn), and cites concrete work history and evidence.',
    features: ['Verified direct emails', 'Web evidence & citations', 'Evidence confidence score'],
    icon: 'search',
    accent: '#5BD69A',
    bgGlow: 'rgba(91, 214, 154, 0.08)',
  },
  {
    step: '04',
    badge: 'Personalisation',
    badgeColor: 'border-[#3B3577] bg-[#1B1830] text-[#B1A6FF]',
    title: 'Personalised Outreach',
    subtitle: 'Personalization Agent',
    description:
      'Synthesises verified research into authentic 1-to-1 outreach across 5 distinct channels with automated QA to eliminate hallucinations and generic clichés.',
    features: ['Email · LinkedIn · WhatsApp', 'Website Form · Direct Message', 'Automated QA verification'],
    icon: 'sparkle',
    accent: '#B1A6FF',
    bgGlow: 'rgba(177, 166, 255, 0.08)',
  },
  {
    step: '05',
    badge: 'Control',
    badgeColor: 'border-[#2A374A] bg-[#121B27] text-[#9BE6EE]',
    title: 'Review & Send',
    subtitle: 'Human-in-the-Loop',
    description:
      'Review prospect evidence, approve or edit copy in real time, track outreach as Sent, and provide feedback that the AI immediately learns for future leads.',
    features: ['Citation transparency', 'Live inline editing & review', 'Outreach status & feedback memory'],
    icon: 'send',
    accent: '#9BE6EE',
    bgGlow: 'rgba(155, 230, 238, 0.08)',
  },
];

export default function PlatformWorkflowVisualizer({
  onGetStarted,
}: {
  onGetStarted?: () => void;
}) {
  return (
    <section
      aria-label="How MARCOM Works Platform Visualization"
      className="flex flex-col gap-6 rounded-3xl border border-[#2A2F39] bg-[#12151B] p-6 sm:p-8"
    >
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#232832] pb-6">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#5ED3DF]">
            <span className="h-2 w-2 rounded-full bg-[#5ED3DF] shadow-[0_0_8px_#5ED3DF]" />
            Platform Architecture &amp; Workflow
          </div>
          <h2 className={`${serif} m-0 mt-2 text-[26px] sm:text-[30px] font-semibold text-[#F1F2F4]`}>
            How MARCOM Works
          </h2>
          <p className="m-0 mt-1.5 text-sm leading-relaxed text-[#A7ADB8]">
            An end-to-end multi-agent pipeline designed to transform campaign briefs into high-confidence prospect discoveries and hyper-personalised, verified outreach.
          </p>
        </div>

        
      </div>

      {/* Workflow Step Grid with connection indicators */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        {WORKFLOW_STEPS.map((step, idx) => (
          <div
            key={step.step}
            style={{ backgroundColor: '#171A21' }}
            className="relative flex flex-col justify-between rounded-2xl border border-[#272C36] p-4.5 transition hover:border-[#3A4252] hover:shadow-lg"
          >
            {/* Top row: Number and Badge */}
            <div>
              <div className="flex items-center justify-between gap-2">
                <span
                  style={{ color: step.accent }}
                  className="font-mono text-xs font-bold tracking-wider opacity-85"
                >
                  {step.step}
                </span>
                <span
                  className={`rounded-md border px-2 py-0.5 text-[10.5px] font-semibold ${step.badgeColor}`}
                >
                  {step.badge}
                </span>
              </div>

              {/* Icon & Title */}
              <div className="mt-3.5 flex items-center gap-2.5">
                <div
                  style={{
                    backgroundColor: step.bgGlow,
                    color: step.accent,
                    borderColor: `${step.accent}33`,
                  }}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border"
                >
                  <Icon name={step.icon} size={18} stroke={2} />
                </div>
                <div className="min-w-0">
                  <h3 className="m-0 text-[14.5px] font-semibold leading-snug text-[#F1F2F4]">
                    {step.title}
                  </h3>
                  <div className="text-[11.5px] font-medium text-[#8A909C]">
                    {step.subtitle}
                  </div>
                </div>
              </div>

              {/* Description */}
              <p className="m-0 mt-3 text-[12px] leading-relaxed text-[#9BA1AE]">
                {step.description}
              </p>
            </div>

            {/* Feature Pills */}
            <div className="mt-4 border-t border-[#222630] pt-3">
              <ul className="m-0 space-y-1.5 p-0 list-none">
                {step.features.map((feat) => (
                  <li
                    key={feat}
                    className="flex items-center gap-1.5 text-[11px] text-[#A7ADB8]"
                  >
                    <Icon name="check" size={11} stroke={2.5} className="text-[#5ED3DF]" />
                    <span>{feat}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Connector arrow for desktop (except last item) */}
            {idx < WORKFLOW_STEPS.length - 1 && (
              <div className="hidden lg:block absolute -right-2.5 top-1/2 -translate-y-1/2 z-10 text-[#424856]">
                <Icon name="chevronRight" size={14} stroke={2.5} />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Platform Guarantees Banner */}
      <div className="grid gap-3 rounded-2xl border border-[#232832] bg-[#0E1015] p-4 sm:grid-cols-3">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#2E6B75] bg-[#12313A] text-[#5ED3DF]">
            <Icon name="shield" size={16} />
          </div>
          <div>
            <div className="text-xs font-semibold text-[#F1F2F4]">Saved Only on This Device</div>
            <div className="mt-0.5 text-[11.5px] text-[#8A909C]">
              In Guest Mode, your projects, leads, and drafts stay isolated and saved only on this device in your browser&apos;s IndexedDB.
            </div>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#1F4A33] bg-[#10261B] text-[#5BD69A]">
            <Icon name="check" size={16} />
          </div>
          <div>
            <div className="text-xs font-semibold text-[#F1F2F4]">Evidence-Grounded Copy</div>
            <div className="mt-0.5 text-[11.5px] text-[#8A909C]">
              No generic templates or false claims. Outreach drafts weave in specific, verified facts found during research.
            </div>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#3B3577] bg-[#1B1830] text-[#B1A6FF]">
            <Icon name="sparkle" size={16} />
          </div>
          <div>
            <div className="text-xs font-semibold text-[#F1F2F4]">5-Channel Outreach</div>
            <div className="mt-0.5 text-[11.5px] text-[#8A909C]">
              Instant tailor-made copy for Email, LinkedIn inMail, WhatsApp, Website contact forms, and Direct Messages.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
