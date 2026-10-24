import { ChevronDown } from 'lucide-react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import styles from './station-wizard.module.css';

type FieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  label: string;
  value: unknown;
  onChange: (value: string | number | undefined) => void;
  suffix?: string;
  optional?: boolean;
};

export function WizardField({ label, value, onChange, suffix, optional, type = 'text', ...props }: FieldProps) {
  return <label className={styles.field}>
    <span>{label}{optional && <small>Opcional</small>}</span>
    <span className={styles.inputWrap}>
      <input {...props} type={type} step={type === 'number' ? (props.step ?? 'any') : props.step}
        value={String(value ?? '')} onChange={event => onChange(type === 'number'
          ? (event.target.value === '' ? undefined : Number(event.target.value)) : event.target.value)} />
      {suffix && <span className={styles.suffix}>{suffix}</span>}
    </span>
  </label>;
}

export function WizardDisclosure({ title, children, open = false, className = '' }: {
  title: string; children: ReactNode; open?: boolean; className?: string;
}) {
  return <details className={`${styles.disclosure} ${className}`} open={open || undefined}>
    <summary>{title}<ChevronDown size={16} aria-hidden="true" /></summary>
    <div className={styles.disclosureBody}>{children}</div>
  </details>;
}
