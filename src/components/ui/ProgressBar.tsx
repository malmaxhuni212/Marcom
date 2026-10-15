'use client';

import React from 'react';

interface ProgressBarProps {
  current: number;
  total: number;
  color: 'blue' | 'pink' | 'purple' | 'amber';
  className?: string;
}

const colorMap = {
  blue: 'from-blue-500 to-cyan-400',
  pink: 'from-pink-500 to-rose-400',
  purple: 'from-purple-500 to-violet-400',
  amber: 'from-amber-500 to-yellow-400'
};

export default function ProgressBar({ current, total, color, className = '' }: ProgressBarProps) {
  const percentage = total > 0 ? Math.min(100, Math.max(0, (current / total) * 100)) : 0;
  const gradient = colorMap[color] || colorMap.blue;

  return (
    <div className={`w-full h-1.5 bg-white/[0.06] rounded-full overflow-hidden ${className}`}>
      <div 
        className={`h-full bg-gradient-to-r ${gradient} transition-all duration-500 rounded-full`}
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
}
