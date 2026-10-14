'use client';

import { Popover, type PopoverProps } from '@/components/ui/Popover';
import styles from './station-list.module.css';

export function StationListPopover({ className = '', buttonClassName = '', active = false, ...props }: PopoverProps & { active?: boolean }) {
  return <Popover {...props} className={`${styles.popover} ${className}`} buttonClassName={`${buttonClassName} ${active ? styles.controlActive : ''}`} />;
}
