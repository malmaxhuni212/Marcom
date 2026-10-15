'use client';

import React from 'react';

interface AvatarProps {
  initials: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export default function Avatar({ initials, size = 'md', className = '' }: AvatarProps) {
  const sizeClasses = {
    sm: 'w-8 h-8 text-xs',
    md: 'w-9 h-9 text-sm',
    lg: 'w-11 h-11 text-base'
  };

  return (
    <div className={`flex items-center justify-center rounded-full bg-white/[0.08] border border-white/[0.1] text-white/80 font-medium ${sizeClasses[size]} ${className}`}>
      {initials.substring(0, 2).toUpperCase()}
    </div>
  );
}
