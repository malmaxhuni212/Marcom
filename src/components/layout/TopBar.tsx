'use client';

import SearchBar from '@/components/ui/SearchBar';
import Avatar from '@/components/ui/Avatar';

export default function TopBar() {
  return (
    <header className="h-[64px] flex items-center justify-between px-8 border-b border-white/[0.04] bg-[#08080c]/60 backdrop-blur-2xl sticky top-0 z-40">
      {/* Search */}
      <div className="flex-1 max-w-xl">
        <SearchBar />
      </div>

      {/* Right side */}
      <div className="flex items-center gap-4 ml-6">
        {/* Notification bell */}
        <button className="relative p-2 rounded-xl text-white/35 hover:text-white/60 hover:bg-white/[0.04] transition-all duration-200">
          <svg className="w-[18px] h-[18px]" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 2a5 5 0 00-5 5v3l-1.5 2.5a.5.5 0 00.43.75h12.14a.5.5 0 00.43-.75L15 10V7a5 5 0 00-5-5z" />
            <path d="M8.5 15a1.5 1.5 0 003 0" />
          </svg>
          {/* Notification dot */}
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-accent-pink rounded-full animate-subtle-pulse" />
        </button>

        {/* Divider */}
        <div className="h-5 w-px bg-white/[0.06]" />

        {/* User Avatar */}
        <button className="flex items-center gap-2.5 px-2 py-1.5 rounded-xl hover:bg-white/[0.04] transition-all duration-200 group">
          <Avatar initials="G" size="sm" />
          <svg className="w-3 h-3 text-white/25 group-hover:text-white/40 transition-colors" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 4.5l3 3 3-3" />
          </svg>
        </button>
      </div>
    </header>
  );
}
