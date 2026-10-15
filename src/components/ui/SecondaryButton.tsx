'use client';

import React, { ReactNode } from 'react';

interface SecondaryButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  icon?: ReactNode;
  className?: string;
}

export default function SecondaryButton({ children, icon, className = '', ...props }: SecondaryButtonProps) {
  return (
    <button
      className={`
        bg-white/[0.06] border border-white/[0.08] text-white/80 rounded-xl px-6 py-3 text-sm backdrop-blur-sm
        hover:bg-white/[0.1] hover:border-white/[0.15]
        flex items-center justify-center gap-2 transition-all duration-200
        ${className}
      `}
      {...props}
    >
      {icon && <span className="flex items-center">{icon}</span>}
      {children}
    </button>
  );
}
