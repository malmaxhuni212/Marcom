'use client';

import SearchBar from '@/components/ui/SearchBar';
import Avatar from '@/components/ui/Avatar';
import NotificationBell from './NotificationBell';
import { authenticatedFetch } from '@/auth/client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function TopBar() {
  const router = useRouter();
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);

  async function signOut() {
    setProfileMenuOpen(false);
    await authenticatedFetch('/api/v1/auth/session', { method: 'DELETE' }).catch(() => undefined);
    router.replace('/login');
    router.refresh();
  }

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

        {/* User menu */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setProfileMenuOpen((open) => !open)}
            aria-label="Open profile menu"
            aria-haspopup="menu"
            aria-expanded={profileMenuOpen}
            className="flex items-center gap-2.5 px-2 py-1.5 rounded-xl hover:bg-white/[0.04] transition-all duration-200 group"
          >
            <Avatar initials="G" size="sm" />
            <svg
              className={`w-3 h-3 text-white/25 group-hover:text-white/40 transition-all ${profileMenuOpen ? 'rotate-180' : ''}`}
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M3 4.5l3 3 3-3" />
            </svg>
          </button>

          {profileMenuOpen ? (
            <div
              role="menu"
              className="absolute right-0 mt-2 w-52 overflow-hidden rounded-xl border border-white/10 bg-[#13151d] p-2 shadow-2xl"
            >
              <div className="border-b border-white/8 px-3 py-2.5">
                <p className="text-xs font-medium text-white/80">MARCOM Shared Pilot</p>
                <p className="mt-0.5 text-[11px] text-white/40">Internal access</p>
              </div>
              <button
                type="button"
                role="menuitem"
                onClick={signOut}
                className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm text-red-300 transition hover:bg-red-500/10 hover:text-red-200"
              >
                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M8 4H4.5A1.5 1.5 0 003 5.5v9A1.5 1.5 0 004.5 16H8" />
                  <path d="M12.5 6.5L16 10l-3.5 3.5M7 10h9" />
                </svg>
                Sign out
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
