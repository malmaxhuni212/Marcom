'use client';

import React, { ReactNode } from 'react';

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  className?: string;
}

export default function SectionHeader({ title, subtitle, action, className = '' }: SectionHeaderProps) {
  return (
    <div className={`flex items-center justify-between w-full ${className}`}>
      <div>
        <h2 className="text-2xl font-semibold text-white/90 font-sans tracking-tight">{title}</h2>
        {subtitle && <p className="text-sm text-white/40 mt-1">{subtitle}</p>}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}
