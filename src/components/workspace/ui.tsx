'use client';

/**
 * Shared visual primitives for the MARCOM workspace (prototype design system).
 * Palette: page #0E1014 · sidebar #0B0D10 · surface #171A20 · inset #12151A · border #2A2F39
 * Accents: cyan #5ED3DF · purple #B1A6FF · amber #F2C36B · green #5BD69A · red #F28B82
 */
import type { ReactNode } from 'react';
import { initials as computeInitials } from './format';

export const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-[#F1F2F4] px-5 text-sm font-semibold text-[#0E1014] transition hover:bg-white disabled:cursor-not-allowed disabled:bg-[#22262E] disabled:text-[#8A909C]';
export const btnSecondary =
  'inline-flex items-center justify-center gap-2 rounded-xl border border-[#2A2F39] bg-[#171A20] px-4 text-sm font-semibold text-[#F1F2F4] transition hover:border-[#3A3F4A] hover:bg-[#1F232B] disabled:cursor-not-allowed disabled:opacity-50';
export const btnDanger =
  'inline-flex items-center justify-center gap-2 rounded-xl border border-[#3A303A] bg-[#1C1517] px-4 text-sm font-semibold text-[#F28B82] transition hover:bg-[#2A1715] disabled:cursor-not-allowed disabled:opacity-50';
export const card = 'rounded-[20px] border border-[#2A2F39] bg-[#171A20]';
export const inset = 'rounded-2xl border border-[#2A2F39] bg-[#12151A]';
export const inputClass =
  'w-full rounded-xl border border-[#2A2F39] bg-[#0E1014] px-3.5 py-2.5 text-sm text-[#F1F2F4] outline-none placeholder:text-[#5C616B] focus:border-[#2E6B75]';
export const serif = 'font-serif font-semibold tracking-[-0.01em]';

type IconName =
  | 'home' | 'review' | 'list' | 'send' | 'chart' | 'plug' | 'settings' | 'search' | 'plus' | 'chevronDown'
  | 'chevronRight' | 'chevronLeft' | 'arrowRight' | 'arrowLeft' | 'check' | 'x' | 'close' | 'shield' | 'pin' | 'bell'
  | 'copy' | 'refresh' | 'edit' | 'sparkle' | 'warning' | 'info' | 'link' | 'filter' | 'updown' | 'menu' | 'spinner'
  | 'external' | 'message' | 'mail';

const PATHS: Record<IconName, ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  review: <><rect x="4" y="3" width="16" height="18" rx="3" /><path d="m9 12 2 2 4-4" /></>,
  list: <><path d="M8 6h13" /><path d="M8 12h13" /><path d="M8 18h13" /><path d="M3 6h.01" /><path d="M3 12h.01" /><path d="M3 18h.01" /></>,
  send: <><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4z" /></>,
  chart: <><path d="M5 20V10" /><path d="M12 20V4" /><path d="M19 20v-7" /></>,
  plug: <><path d="M9 3v4" /><path d="M15 3v4" /><path d="M6 7h12v4a6 6 0 0 1-12 0z" /><path d="M12 17v4" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.9 4.9 7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronRight: <path d="m9 6 6 6-6 6" />,
  chevronLeft: <path d="m15 18-6-6 6-6" />,
  arrowRight: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
  arrowLeft: <><path d="M19 12H5" /><path d="m11 18-6-6 6-6" /></>,
  check: <path d="M20 6 9 17l-5-5" />,
  x: <><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>,
  close: <><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>,
  shield: <><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" /><path d="m9 12 2 2 4-4" /></>,
  pin: <><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></>,
  bell: <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></>,
  copy: <><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" /></>,
  refresh: <><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></>,
  edit: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></>,
  sparkle: <path d="m12 3 1.9 5.8L20 10l-5 3.6L16.5 20 12 16.3 7.5 20 9 13.6 4 10l6.1-1.2z" />,
  warning: <><path d="M12 3 2 20h20z" /><path d="M12 10v4" /><path d="M12 17h.01" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 8h.01" /></>,
  link: <><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" /><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" /></>,
  filter: <><path d="M4 6h16" /><path d="M7 12h10" /><path d="M10 18h4" /></>,
  updown: <><path d="m7 15 5 5 5-5" /><path d="m7 9 5-5 5 5" /></>,
  menu: <><path d="M4 6h16" /><path d="M4 12h16" /><path d="M4 18h16" /></>,
  spinner: <path d="M21 12a9 9 0 1 1-6.2-8.6" />,
  external: <><path d="M14 4h6v6" /><path d="M20 4 10 14" /><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /></>,
  message: <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>,
};

export function Icon({ name, size = 16, stroke = 2, className = '' }: { name: IconName; size?: number; stroke?: number; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`${name === 'spinner' ? 'animate-spin' : ''} shrink-0 ${className}`}
    >
      {PATHS[name]}
    </svg>
  );
}

const ART_PALETTES = [
  ['#1E5560', '#3B3577', '#5ED3DF', '#9BE6EE', '#CFC8FF'],
  ['#3B3577', '#5B2F55', '#B1A6FF', '#CFC8FF', '#F7B1AA'],
  ['#1F4A33', '#1E5560', '#5BD69A', '#8EE6B6', '#9BE6EE'],
  ['#4A3B17', '#3B3577', '#F2C36B', '#F7D58E', '#CFC8FF'],
];

function hashOf(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  return hash;
}

/** Abstract project artwork from the prototype; colours vary per project. */
export function ProjectArt({ seed, size = 88, radius }: { seed: string; size?: number; radius?: number }) {
  const [a, b, c, d, e] = ART_PALETTES[hashOf(seed) % ART_PALETTES.length]!;
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 104 104" style={{ borderRadius: radius ?? size * 0.25 }} className="block shrink-0">
      <rect width="104" height="104" fill="#16202A" />
      <circle cx="40" cy="46" r="26" fill={a} />
      <circle cx="64" cy="46" r="26" fill={b} fillOpacity="0.85" />
      <circle cx="52" cy="66" r="22" fill={c} fillOpacity="0.35" />
      {size >= 56 && (
        <>
          <circle cx="40" cy="46" r="5" fill={d} />
          <circle cx="64" cy="46" r="5" fill={e} />
          <circle cx="52" cy="68" r="5" fill="#F1F2F4" />
          <path d="M40 46 64 46 52 68Z" fill="none" stroke="#F1F2F4" strokeOpacity="0.6" strokeWidth="1.5" />
        </>
      )}
    </svg>
  );
}

export function Initials({ text, name, size = 36 }: { text?: string; name?: string; size?: number }) {
  const display = text ?? computeInitials(name ?? '');
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      className="flex shrink-0 items-center justify-center rounded-[10px] bg-[#1F232B] font-semibold text-[#C9CDD4]"
    >
      {display}
    </span>
  );
}

export function Pill({ children, bg, fg, className = '' }: { children: ReactNode; bg: string; fg: string; className?: string }) {
  return (
    <span style={{ background: bg, color: fg }} className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-[3px] text-[11.5px] font-semibold ${className}`}>
      {children}
    </span>
  );
}

export function Eyebrow({ children, color = '#8A909C' }: { children: ReactNode; color?: string }) {
  return (
    <div style={{ color }} className="text-[11.5px] font-semibold uppercase tracking-[0.14em]">
      {children}
    </div>
  );
}

/** Four-step campaign progress bar (Brief · Targets · Research · Review). */
export function StepProgress({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div aria-label="Campaign progress" className="flex flex-col gap-2">
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((step, index) => (
          <div key={step} className="h-1 rounded-sm" style={{ background: index < current ? '#5ED3DF' : '#3A3F4A' }} />
        ))}
      </div>
      <div className="grid gap-1.5 text-xs text-[#A7ADB8]" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((step, index) => (
          <div key={step} style={index === current ? { color: '#F2C36B', fontWeight: 600 } : undefined}>
            {step}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Centered dialog with the prototype's overlay treatment. */
export function Dialog({
  label,
  onClose,
  width = 640,
  children,
}: {
  label: string;
  onClose: () => void;
  width?: number;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto">
      <button type="button" aria-label="Close" onClick={onClose} className="fixed inset-0 h-full w-full cursor-default bg-[rgba(4,5,7,0.7)]" />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={label}
        style={{ maxWidth: width }}
        className="relative mx-auto my-10 w-[calc(100%-32px)] rounded-3xl border border-[#2E333D] bg-[#171A20] shadow-[0_30px_80px_rgba(0,0,0,0.6)] sm:my-20"
      >
        {children}
      </section>
    </div>
  );
}

export function CloseButton({ onClick, label = 'Close' }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#2A2F39] bg-[#0E1014] text-[#F1F2F4] transition hover:bg-[#1F232B]"
    >
      <Icon name="x" size={14} stroke={2.2} />
    </button>
  );
}

export function Spinner({ size = 18 }: { size?: number }) {
  return <Icon name="spinner" size={size} stroke={2.4} className="text-[#5ED3DF]" />;
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed border-[#2E333D] px-6 py-8">
      <div className="text-base font-semibold text-[#F1F2F4]">{title}</div>
      <p className="max-w-xl text-sm leading-relaxed text-[#A7ADB8]">{body}</p>
      {action}
    </div>
  );
}
