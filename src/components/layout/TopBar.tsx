'use client';

import SearchBar from '@/components/ui/SearchBar';
import Avatar from '@/components/ui/Avatar';
import NotificationBell from './NotificationBell';

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
        <NotificationBell />

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
