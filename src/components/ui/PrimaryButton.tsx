'use client';

import React, { ReactNode } from 'react';

interface PrimaryButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  icon?: ReactNode;
  className?: string;
}

export default function PrimaryButton({ children, icon, className = '', ...props }: PrimaryButtonProps) {
  return (
    <button
      className={`
        bg-white text-black font-medium rounded-xl px-6 py-3 text-sm
        hover:bg-white/90 hover:scale-[1.02]
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
