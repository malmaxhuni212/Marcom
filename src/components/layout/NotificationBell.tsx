'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { authenticatedFetch } from '@/auth/client';

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

const TONE_MAP: Record<NotificationItem['type'], { bg: string; border: string; dot: string }> = {
  success: { bg: '#12313A', border: '#2E6B75', dot: '#5ED3DF' },
  agent: { bg: '#12313A', border: '#2E6B75', dot: '#5ED3DF' },
  warning: { bg: '#231D10', border: '#4A3B17', dot: '#F2C36B' },
  info: { bg: '#171A20', border: '#2A2F39', dot: '#B1A6FF' },
};

let cachedNotifications: NotificationItem[] | null = null;
let cachedNotificationsAt = 0;

export default function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>(() => cachedNotifications ?? []);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(() => cachedNotifications === null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('marcom_read_notifications');
      if (stored) setReadIds(new Set(JSON.parse(stored)));
    } catch {
      // ignore
    }
  }, []);

  const fetchNotifications = async (force = false) => {
    if (!force && cachedNotifications && Date.now() - cachedNotificationsAt < 25000) {
      setNotifications(cachedNotifications);
      setLoading(false);
      return;
    }
    try {
      const res = await authenticatedFetch('/api/notifications');
      if (res.ok) {
        const data = await res.json();
        const items = Array.isArray(data) ? data : [];
        cachedNotifications = items;
        cachedNotificationsAt = Date.now();
        setNotifications(items);
      }
    } catch {
      // ignore background polling error
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchNotifications(false);
    const interval = setInterval(() => void fetchNotifications(true), 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const markAllAsRead = () => {
    const allIds = new Set(notifications.map((n) => n.id));
    setReadIds(allIds);
    try {
      localStorage.setItem('marcom_read_notifications', JSON.stringify(Array.from(allIds)));
    } catch {
      // ignore
    }
  };

  const markOneAsRead = (id: string) => {
    setReadIds((prev) => {
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

  const fresh = notifications.filter((n) => !readIds.has(n.id));
  const earlier = notifications.filter((n) => readIds.has(n.id));

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label="Notifications"
        aria-expanded={isOpen}
        className="relative flex h-[42px] w-[42px] items-center justify-center rounded-xl border border-[#2A2F39] bg-[#171A20] text-[#F1F2F4] transition hover:border-[#3A3F4A]"
      >
        <svg
          aria-hidden="true"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {fresh.length > 0 && (
          <span
            aria-hidden="true"
            className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full bg-[#F2C36B]"
          />
        )}
      </button>

      {isOpen && (
        <section
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 top-[calc(100%+8px)] z-[60] flex w-[400px] max-w-[calc(100vw-32px)] flex-col rounded-[20px] border border-[#2E333D] bg-[#171A20] shadow-[0_24px_60px_rgba(0,0,0,0.6)]"
        >
          <div className="flex items-center justify-between px-[18px] pb-2.5 pt-4">
            <h2 className="m-0 text-base font-semibold text-[#F1F2F4]">Notifications</h2>
            {fresh.length > 0 && (
              <button
                type="button"
                onClick={markAllAsRead}
                className="h-8 border-0 bg-transparent px-1.5 text-[13px] font-semibold text-[#5ED3DF] hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="flex max-h-[420px] flex-col gap-2 overflow-y-auto px-3 pb-3">
            {loading && notifications.length === 0 ? (
              <div className="py-8 text-center text-xs text-[#8A909C]">Loading notifications…</div>
            ) : notifications.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[#2E333D] px-4 py-6 text-center text-xs text-[#A7ADB8]">
                No notifications yet. We&apos;ll notify you when research runs or drafts finish.
              </div>
            ) : (
              <>
                {fresh.map((item) => {
                  const tone = TONE_MAP[item.type] ?? TONE_MAP.info;
                  const inner = (
                    <span
                      style={{ background: tone.bg, borderColor: tone.border }}
                      className="flex gap-3 rounded-[14px] border p-3 text-[#F1F2F4]"
                    >
                      <span
                        aria-hidden="true"
                        style={{ background: tone.dot }}
                        className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                      />
                      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                        <span className="text-sm font-semibold leading-snug">{item.title}</span>
                        <span className="text-[13px] leading-snug text-[#A7ADB8]">
                          {item.message}
                        </span>
                        <span className="text-xs text-[#8A909C]">{item.timestamp}</span>
                      </span>
                    </span>
                  );

                  return item.link ? (
                    <Link
                      key={item.id}
                      href={item.link}
                      onClick={() => {
                        markOneAsRead(item.id);
                        setIsOpen(false);
                      }}
                      className="no-underline"
                    >
                      {inner}
                    </Link>
                  ) : (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => markOneAsRead(item.id)}
                      className="border-0 bg-transparent p-0 text-left"
                    >
                      {inner}
                    </button>
                  );
                })}

                {earlier.length > 0 && (
                  <>
                    <div className="px-1 pt-1.5 text-[11px] font-semibold tracking-[0.1em] text-[#8A909C]">
                      EARLIER
                    </div>
                    {earlier.map((item) => {
                      const row = (
                        <span className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-[13px] text-[#C9CDD4] hover:bg-[#1F232B]">
                          <span className="truncate">{item.title}</span>
                          <span className="shrink-0 text-xs text-[#8A909C]">{item.timestamp}</span>
                        </span>
                      );
                      return item.link ? (
                        <Link
                          key={item.id}
                          href={item.link}
                          onClick={() => setIsOpen(false)}
                          className="no-underline"
                        >
                          {row}
                        </Link>
                      ) : (
                        <div key={item.id}>{row}</div>
                      );
                    })}
                  </>
                )}
              </>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
