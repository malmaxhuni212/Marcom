'use client';

import React from 'react';

interface SearchBarProps extends React.InputHTMLAttributes<HTMLInputElement> {
  className?: string;
}

export default function SearchBar({ className = '', ...props }: SearchBarProps) {
  return (
    <div className={`relative w-full max-w-xl ${className}`}>
      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
        <svg 
          xmlns="http://www.w3.org/2000/svg" 
          className="h-5 w-5 text-white/30" 
          fill="none" 
          viewBox="0 0 24 24" 
          stroke="currentColor" 
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>
      <input
        type="text"
        placeholder="Search projects, prospects, or messages..."
        className="block w-full bg-white/[0.04] border border-white/[0.06] rounded-xl pl-10 pr-4 py-2.5 text-sm text-white/60 placeholder:text-white/30 backdrop-blur-sm focus:border-white/[0.12] focus:outline-none focus:ring-1 focus:ring-white/[0.05] transition-all"
        {...props}
      />
    </div>
  );
}
