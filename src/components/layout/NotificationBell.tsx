'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';

interface NotificationItem {
  id: string;
  title: string;
  message: string;
  timestamp: string;
  sortTime: number;
  type: 'success' | 'info' | 'agent' | 'warning';
  icon: string;
  link?: string;
  projectName?: string;
}

export default function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Load read status from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem('marcom_read_notifications');
      if (stored) {
        setReadIds(new Set(JSON.parse(stored)));
      }
    } catch {
      // ignore
    }
  }, []);

  // Fetch live notifications from backend
  const fetchNotifications = async () => {
    try {
      const res = await fetch('/api/notifications');
      if (res.ok) {
        const data = await res.json();
        setNotifications(data);
      }
    } catch (err) {
      console.error('Failed to load notifications', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNotifications();
    // Poll every 30 seconds for background updates
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, []);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const markAllAsRead = () => {
    const allIds = new Set(notifications.map(n => n.id));
    setReadIds(allIds);
    try {
      localStorage.setItem('marcom_read_notifications', JSON.stringify(Array.from(allIds)));
    } catch {
      // ignore
    }
  };

  const markOneAsRead = (id: string) => {
    setReadIds(prev => {
      const next = new Set(prev);
      next.add(id);
      try {
        localStorage.setItem('marcom_read_notifications', JSON.stringify(Array.from(next)));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const unreadCount = notifications.filter(n => !readIds.has(n.id)).length;

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell Button */}
      <button 
        type="button"
        onClick={() => setIsOpen(prev => !prev)}
        className={`relative p-2 rounded-xl text-white/45 hover:text-white/80 hover:bg-white/[0.05] transition-all duration-200 ${isOpen ? 'bg-white/[0.08] text-white/90' : ''}`}
        aria-label="View notifications"
        aria-expanded={isOpen}
      >
        <svg className="w-[18px] h-[18px]" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 2a5 5 0 00-5 5v3l-1.5 2.5a.5.5 0 00.43.75h12.14a.5.5 0 00.43-.75L15 10V7a5 5 0 00-5-5z" />
          <path d="M8.5 15a1.5 1.5 0 003 0" />
        </svg>

        {/* Pink Notification Dot (shows when unread items exist) */}
        {unreadCount > 0 && (
          <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 bg-accent-pink rounded-full ring-2 ring-[#08080c] animate-subtle-pulse" />
        )}
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute right-0 mt-2.5 w-[380px] sm:w-[420px] rounded-2xl border border-white/[0.08] bg-[#0c0c12]/95 backdrop-blur-2xl shadow-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3.5 border-b border-white/[0.06] bg-white/[0.02]">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-white/90">Recent Activity & Updates</h3>
              {unreadCount > 0 && (
                <span className="text-[10px] font-semibold text-accent-pink bg-pink-500/10 border border-pink-500/20 px-2 py-0.5 rounded-full">
                  {unreadCount} new
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button 
                type="button" 
                onClick={markAllAsRead}
                className="text-[11px] text-white/40 hover:text-cyan-300 transition-colors"
              >
                Mark all read
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-[380px] overflow-y-auto divide-y divide-white/[0.04]">
            {loading && notifications.length === 0 ? (
              <div className="py-8 text-center text-xs text-white/40">
                Checking backend activities...
              </div>
            ) : notifications.length === 0 ? (
              <div className="py-8 text-center text-xs text-white/40">
                No recent backend activities yet.
              </div>
            ) : (
              notifications.map((n) => {
                const isUnread = !readIds.has(n.id);
                const itemContent = (
                  <div 
                    className={`flex items-start gap-3 p-3.5 transition-colors ${
                      isUnread ? 'bg-white/[0.03] hover:bg-white/[0.06]' : 'hover:bg-white/[0.02]'
                    }`}
                    onClick={() => markOneAsRead(n.id)}
                  >
                    {/* Icon */}
                    <div className="shrink-0 w-8 h-8 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-sm mt-0.5">
                      {n.icon}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <h4 className={`text-xs font-medium truncate ${isUnread ? 'text-white' : 'text-white/80'}`}>
                          {n.title}
                        </h4>
                        <span className="text-[10px] text-white/30 shrink-0">
                          {n.timestamp}
                        </span>
                      </div>
                      <p className="text-[11px] text-white/50 mt-1 leading-relaxed line-clamp-2">
                        {n.message}
                      </p>
                      {n.link && (
                        <span className="inline-flex items-center gap-1 mt-1.5 text-[10px] font-medium text-cyan-300 hover:text-cyan-200">
                          View details →
                        </span>
                      )}
                    </div>

                    {/* Unread indicator point */}
                    {isUnread && (
                      <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-cyan-400 mt-2" />
                    )}
                  </div>
                );

                return n.link ? (
                  <Link 
                    key={n.id} 
                    href={n.link} 
                    onClick={() => {
                      markOneAsRead(n.id);
                      setIsOpen(false);
                    }}
                    className="block"
                  >
                    {itemContent}
                  </Link>
                ) : (
                  <div key={n.id}>
                    {itemContent}
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2.5 border-t border-white/[0.06] bg-white/[0.015] flex items-center justify-between text-[11px]">
            <div className="flex items-center gap-1.5 text-white/40">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>Agents operational</span>
            </div>
            <button 
              type="button"
              onClick={() => {
                setIsOpen(false);
                const el = document.getElementById('agent-activity');
                if (el) {
                  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                } else {
                  window.location.href = '/#agent-activity';
                }
              }}
              className="text-white/40 hover:text-cyan-300 transition-colors cursor-pointer"
            >
              View activity feed ↓
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
