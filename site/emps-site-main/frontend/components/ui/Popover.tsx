'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from './popover.module.css';

export type PopoverProps = {
  label: string;
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
  className?: string;
  buttonClassName?: string;
  align?: 'start' | 'end';
  side?: 'bottom' | 'right';
  openOnHover?: boolean;
};

export function Popover({ label, trigger, children, className = '', buttonClassName = '', align = 'end', side = 'bottom', openOnHover = false }: PopoverProps) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number; fontFamily: string; transformOrigin: string } | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openedByHover = useRef(false);

  function cancelClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }
  function cancelOpen() {
    if (openTimer.current) clearTimeout(openTimer.current);
    openTimer.current = null;
  }

  function focusPanel() {
    panel.current?.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]')?.focus();
  }

  function openFromKeyboard() {
    cancelOpen();
    cancelClose();
    openedByHover.current = false;
    if (open) focusPanel();
    else { setPosition(null); setOpen(true); }
  }

  function hoverOpen() {
    if (!openOnHover) return;
    cancelClose();
    if (open || openTimer.current) return;
    openTimer.current = setTimeout(() => {
      openTimer.current = null;
      openedByHover.current = true;
      setPosition(null); setOpen(true);
    }, 140);
  }

  function hoverLeave() {
    if (!openOnHover) return;
    cancelOpen();
    cancelClose();
    if (!openedByHover.current) return;
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  }

  useEffect(() => () => { cancelOpen(); cancelClose(); }, []);

  useLayoutEffect(() => {
    if (!open || !button.current || !panel.current) return;
    function place() {
      if (!button.current || !panel.current) return;
      const anchor = button.current.getBoundingClientRect();
      // Layout dimensions stay stable while the reveal animation scales the panel.
      const popup = { width: panel.current.offsetWidth, height: panel.current.offsetHeight };
      const preferredLeft = side === 'right' ? anchor.right : align === 'start' ? anchor.left : anchor.right - popup.width;
      const left = Math.max(12, Math.min(preferredLeft, window.innerWidth - popup.width - 12));
      const top = side === 'right' ? Math.min(anchor.top, window.innerHeight - popup.height - 12)
        : anchor.bottom + popup.height + 8 > window.innerHeight && anchor.top > popup.height + 8
        ? anchor.top - popup.height - 8 : Math.min(anchor.bottom + 8, window.innerHeight - popup.height - 12);
      const boundedTop = Math.max(12, top);
      const originX = Math.max(16, Math.min(anchor.left + anchor.width / 2 - left, popup.width - 16));
      const transformOrigin = side === 'right' ? `0 ${Math.max(16, anchor.top + anchor.height / 2 - boundedTop)}px` : `${originX}px ${boundedTop < anchor.top ? '100%' : '0'}`;
      const fontFamily = getComputedStyle(button.current).fontFamily;
      setPosition(previous => previous?.left === left && previous.top === boundedTop && previous.transformOrigin === transformOrigin && previous.fontFamily === fontFamily ? previous : { left, top: boundedTop, fontFamily, transformOrigin });
    }
    place();
    const observer = new ResizeObserver(place);
    observer.observe(panel.current);
    return () => observer.disconnect();
  }, [open, align, side]);

  useEffect(() => {
    if (open && position && !openedByHover.current) focusPanel();
  }, [open, position]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (!button.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); button.current?.focus(); }
    };
    const close = () => setOpen(false);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', close);
    document.addEventListener('scroll', outside, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', close);
      document.removeEventListener('scroll', outside, true);
    };
  }, [open]);

  return <>
    <button ref={button} type="button" className={`${buttonClassName}${open ? ' popover-trigger--open' : ''}`} title={label} aria-label={label} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
      onMouseEnter={hoverOpen} onMouseLeave={hoverLeave}
      onKeyDown={event => { if (event.key === 'Escape') { cancelOpen(); cancelClose(); setOpen(false); } else if (side === 'right' && event.key === 'ArrowRight') { event.preventDefault(); openFromKeyboard(); } }}
      onClick={() => {
        cancelOpen();
        cancelClose();
        const hovered = openedByHover.current;
        openedByHover.current = false;
        if (open && hovered) { focusPanel(); return; }
        setPosition(null);
        setOpen(value => !value);
      }}>{trigger}</button>
    {open && createPortal(<div ref={panel} id={id} role="dialog" aria-label={label} data-positioned={position ? 'true' : undefined} data-side={side} className={`${styles.panel} ${className}`} style={{ ...position, visibility: position ? 'visible' : 'hidden' }}
      onMouseEnter={cancelClose} onMouseLeave={hoverLeave}>
      {children(() => { cancelOpen(); cancelClose(); setOpen(false); button.current?.focus(); })}
    </div>, document.body)}
  </>;
}
