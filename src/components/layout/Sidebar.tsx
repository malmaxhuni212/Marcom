'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const mainNavItems = [
  { label: 'Home', href: '/', icon: 'home' },
  { label: 'Projects', href: '/projects', icon: 'projects' },
  { label: 'Research', href: '/research', icon: 'research' },
  { label: 'Outreach', href: '/outreach', icon: 'outreach' },
  { label: 'Database', href: '/database', icon: 'database' },
  { label: 'Analytics', href: '/analytics', icon: 'analytics' },
];

const secondaryNavItems = [
  { label: 'Integrations', href: '/integrations', icon: 'integrations' },
  { label: 'Settings', href: '/settings', icon: 'settings' },
];

function NavIcon({ icon, className = '' }: { icon: string; className?: string }) {
  const baseClass = `w-[18px] h-[18px] ${className}`;

  switch (icon) {
    case 'home':
      return (
        <svg className={baseClass} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 7.5L10 2l7 5.5v9a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 013 16.5v-9z" />
          <path d="M7.5 18V11h5v7" />
        </svg>
      );
    case 'projects':
      return (
        <svg className={baseClass} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="6" height="6" rx="1" />
          <rect x="11" y="3" width="6" height="6" rx="1" />
          <rect x="3" y="11" width="6" height="6" rx="1" />
          <rect x="11" y="11" width="6" height="6" rx="1" />
        </svg>
      );
    case 'research':
      return (
        <svg className={baseClass} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="8.5" cy="8.5" r="5.5" />
          <line x1="13" y1="13" x2="18" y2="18" />
        </svg>
      );
    case 'outreach':
      return (
        <svg className={baseClass} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 4l8 5 8-5" />
          <rect x="2" y="4" width="16" height="12" rx="1.5" />
        </svg>
      );
    case 'database':
      return (
        <svg className={baseClass} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <ellipse cx="10" cy="5" rx="7" ry="3" />
          <path d="M3 5v10c0 1.66 3.13 3 7 3s7-1.34 7-3V5" />
          <path d="M3 10c0 1.66 3.13 3 7 3s7-1.34 7-3" />
        </svg>
      );
    case 'analytics':
      return (
        <svg className={baseClass} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 17V9" />
          <path d="M7 17V5" />
          <path d="M11 17V11" />
          <path d="M15 17V3" />
        </svg>
      );
    case 'integrations':
      return (
        <svg className={baseClass} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 3v4a2 2 0 002 2h4a2 2 0 002-2V3" />
          <path d="M6 17v-4a2 2 0 012-2h4a2 2 0 012 2v4" />
          <path d="M3 6h4a2 2 0 012 2v4a2 2 0 01-2 2H3" />
          <path d="M17 6h-4a2 2 0 00-2 2v4a2 2 0 002 2h4" />
        </svg>
      );
    case 'settings':
      return (
        <svg className={baseClass} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="10" cy="10" r="3" />
          <path d="M10 1.5v2M10 16.5v2M3.5 3.5l1.4 1.4M15.1 15.1l1.4 1.4M1.5 10h2M16.5 10h2M3.5 16.5l1.4-1.4M15.1 4.9l1.4-1.4" />
        </svg>
      );
    default:
      return null;
  }
}

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 bottom-0 w-[220px] flex flex-col border-r border-white/[0.06] bg-[#08080c]/80 backdrop-blur-2xl z-50">
      {/* Wordmark */}
      <div className="px-6 pt-7 pb-8">
        <h1 className="text-[15px] font-medium tracking-[0.35em] text-white/90 uppercase">
          MARCOM
        </h1>
      </div>

      {/* Main Navigation */}
      <nav className="flex-1 px-3 space-y-0.5">
        {mainNavItems.map((item) => {
          const isActive = item.href === '/' 
            ? pathname === '/' 
            : pathname.startsWith(item.href);
          
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`
                flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium
                transition-all duration-200 group relative
                ${isActive
                  ? 'sidebar-active text-white/95'
                  : 'text-white/45 hover:text-white/70 hover:bg-white/[0.03]'
                }
              `}
            >
              <NavIcon icon={item.icon} className={isActive ? 'text-white/90' : 'text-white/40 group-hover:text-white/60'} />
              <span>{item.label}</span>
              {isActive && (
                <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-accent-purple/[0.05] to-transparent pointer-events-none" />
              )}
            </Link>
          );
        })}

        {/* Divider */}
        <div className="!my-4 mx-3 h-px bg-white/[0.06]" />

        {secondaryNavItems.map((item) => {
          const isActive = item.href === '/' 
            ? pathname === '/' 
            : pathname.startsWith(item.href);
            
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`
                flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium
                transition-all duration-200 group
                ${isActive
                  ? 'sidebar-active text-white/95'
                  : 'text-white/45 hover:text-white/70 hover:bg-white/[0.03]'
                }
              `}
            >
              <NavIcon icon={item.icon} className={isActive ? 'text-white/90' : 'text-white/40 group-hover:text-white/60'} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Workspace Switcher */}
      <div className="px-3 pb-4 space-y-2">
        {/* Workspace */}
        <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all duration-200 hover:bg-white/[0.03] group">
          <div className="w-7 h-7 rounded-lg bg-white/10 border border-white/10 flex items-center justify-center text-[10px] font-bold text-white/70">
            G
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-medium text-white/70 truncate">Guest Workspace</p>
          </div>
          <svg className="w-3.5 h-3.5 text-white/25 group-hover:text-white/40 transition-colors" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M4 6l4 4 4-4" />
          </svg>
        </button>


      </div>
    </aside>
  );
}
