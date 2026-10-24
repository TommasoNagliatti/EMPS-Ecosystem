'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, type ComponentProps } from 'react';
import { api } from '@/services/emps-api';

export function NavigationLink({ href, onMouseEnter, onMouseLeave, onFocus, onPointerDown, ...props }: Omit<ComponentProps<typeof Link>, 'href'> & { href: string }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function cancel() { if (timer.current !== null) { clearTimeout(timer.current); timer.current = null; } }
  function warm() {
    cancel();
    router.prefetch(href);
    void api.prefetchPage(href);
    if (/^\/stations\/\d+\/dashboard$/.test(href)) void import('@/components/dashboard/AdminDashboard').catch(() => undefined);
  }
  useEffect(() => cancel, []);
  return <Link {...props} href={href} prefetch={true}
    onMouseEnter={event => { onMouseEnter?.(event); cancel(); timer.current = setTimeout(warm, 80); }}
    onMouseLeave={event => { onMouseLeave?.(event); cancel(); }}
    onFocus={event => { onFocus?.(event); warm(); }}
    onPointerDown={event => { onPointerDown?.(event); if (event.button === 0) warm(); }} />;
}
