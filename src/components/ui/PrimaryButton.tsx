'use client';

import React, { ReactNode } from 'react';

interface PrimaryButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  icon?: ReactNode;
  className?: string;
}

export default function PrimaryButton({ children, icon, className = '', disabled, ...props }: PrimaryButtonProps) {
  return (
    <button
      disabled={disabled}
      className={`
        bg-white text-black font-medium rounded-xl px-6 py-3 text-sm
        hover:bg-white/90 hover:scale-[1.02]
        disabled:bg-white/10 disabled:text-white/30 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:bg-white/10 disabled:shadow-none
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
