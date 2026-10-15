'use client';

import React, { ReactNode, useState } from 'react';

interface GlassCardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  glow?: string;
  padding?: string;
}

export default function GlassCard({
  children,
  className = '',
  hover = true,
  glow,
  padding = 'p-6',
}: GlassCardProps) {
  const [isHovered, setIsHovered] = useState(false);

  const style = isHovered && glow ? { boxShadow: `0 8px 32px -8px ${glow}40, 0 0 0 1px ${glow}20` } : {};

  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`
        relative backdrop-blur-xl bg-white/[0.03] border border-white/[0.06] rounded-2xl transition-all duration-300
        ${padding}
        ${hover ? 'hover:bg-white/[0.05] hover:border-white/[0.1] hover:-translate-y-[2px] hover:shadow-lg' : ''}
        ${className}
      `}
      style={style}
    >
      {children}
    </div>
  );
}
