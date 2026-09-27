import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { IconX, IconCheck, IconAlert, IconInfo, IconSearch, IconInbox } from './icons-extra';

// ============================= Button =============================

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-outline';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: React.ReactNode;
}

export function Button({ variant = 'secondary', size = 'md', loading, icon, children, className, disabled, ...rest }: ButtonProps) {
  const cls = ['btn', `btn-${variant}`, size !== 'md' ? `btn-${size}` : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  return (
    <button className={cls} disabled={disabled || loading} {...rest}>
      {loading ? <span className="spinner" /> : icon}
      {children}
    </button>
  );
}

export function IconButton({ title, variant = 'ghost', size = 'md', ...rest }: ButtonProps & { title: string }) {
  return <Button {...rest} variant={variant} size={size} className={`btn-icon ${rest.className ?? ''}`} aria-label={title} title={title} />;
}

// ============================= Fields =============================

interface FieldWrapProps {
  label?: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}

export function Field({ label, required, error, hint, children, className }: FieldWrapProps) {
  // Real <label> so screen readers and Playwright getByLabel resolve the control.
  return (
    <label className={`field ${className ?? ''}`}>
      {label && (
        <span className="field-label">
          {label} {required && <span className="req">*</span>}
        </span>
      )}
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function Input({ invalid, className, ...rest }, ref) {
    return <input ref={ref} className={`input ${invalid ? 'invalid' : ''} ${className ?? ''}`} {...rest} />;
  },
);

export function Select({ invalid, className, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <select className={`select ${invalid ? 'invalid' : ''} ${className ?? ''}`} {...rest}>
      {children}
    </select>
  );
}

export function Textarea({ invalid, className, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return <textarea className={`textarea ${invalid ? 'invalid' : ''} ${className ?? ''}`} {...rest} />;
}

export function SearchInput({ onSearch, placeholder, autoFocus, defaultValue }: { onSearch: (v: string) => void; placeholder?: string; autoFocus?: boolean; defaultValue?: string }) {
  const [v, setV] = useState(defaultValue ?? '');
  const t = useRef<ReturnType<typeof setTimeout>>(undefined);
  return (
    <div className="search-input-wrap grow">
      <IconSearch size={15} />
      <input
        className="input"
        style={{ paddingLeft: 34 }}
        placeholder={placeholder ?? 'Search…'}
        value={v}
        autoFocus={autoFocus}
        onChange={(e) => {
          setV(e.target.value);
          clearTimeout(t.current);
          t.current = setTimeout(() => onSearch(e.target.value), 220);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            clearTimeout(t.current);
            onSearch(v);
          }
        }}
      />
    </div>
  );
}

// ============================= Badge =============================

export function Badge({ tone = 'neutral', children, dot }: { tone?: 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'primary'; children: React.ReactNode; dot?: boolean }) {
  return <span className={`badge badge-${tone} ${dot ? 'badge-dot' : ''}`}>{children}</span>;
}

// ============================= Modal =============================

interface ModalProps {
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'md' | 'lg' | 'xl';
  closeOnOverlay?: boolean;
}

export function Modal({ title, onClose, children, footer, size = 'md', closeOnOverlay = true }: ModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (closeOnOverlay && e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`modal ${size !== 'md' ? `modal-${size}` : ''}`} role="dialog" aria-modal="true">
        <div className="modal-header">
          <h2>{title}</h2>
          <IconButton title="Close" onClick={onClose} icon={<IconX size={16} />} />
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  danger,
  requireText,
  onConfirm,
  onClose,
}: {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  requireText?: string;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const blocked = requireText !== undefined && text !== requireText;
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            disabled={blocked}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className={danger ? 'alert alert-error' : 'alert alert-info'} style={{ whiteSpace: 'pre-line' }}>
          <span style={{ marginTop: 1, flex: 'none', display: 'inline-flex' }}>
            <IconAlert size={16} />
          </span>
          <div>{message}</div>
        </div>
        {requireText !== undefined && (
          <Field label={`Type "${requireText}" to confirm`} required>
            <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={requireText} autoFocus />
          </Field>
        )}
      </div>
    </Modal>
  );
}

// ============================= States =============================

export function EmptyState({ icon, title, desc, action }: { icon?: React.ReactNode; title: string; desc?: string; action?: React.ReactNode }) {
  return (
    <div className="state-block">
      <div className="state-icon">{icon ?? <IconInbox size={24} />}</div>
      <div className="state-title">{title}</div>
      {desc && <div className="state-desc">{desc}</div>}
      {action && <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>{action}</div>}
    </div>
  );
}

export function LoadingRows({ rows = 5 }: { rows?: number }) {
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton" style={{ height: 34, width: `${100 - (i % 3) * 6}%` }} />
      ))}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state-block">
      <div className="state-icon" style={{ color: 'var(--dp-error)', background: 'var(--dp-error-bg)' }}>
        <IconAlert size={24} />
      </div>
      <div className="state-title">Something went wrong</div>
      <div className="state-desc">{message}</div>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry} style={{ marginTop: 8 }}>
          Try again
        </Button>
      )}
    </div>
  );
}

// ============================= Pagination =============================

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="pagination">
      <span>
        Showing {from}–{to} of {total}
      </span>
      <div className="pages">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <span>
          Page {page} of {pages}
        </span>
        <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}

// ============================= Toasts =============================

export interface ToastItem {
  id: number;
  kind: 'success' | 'error' | 'info' | 'warning';
  title: string;
  body?: string;
}

const ToastCtx = createContext<{ toast: (kind: ToastItem['kind'], title: string, body?: string) => void }>({ toast: () => undefined });

export function useToast() {
  return useContext(ToastCtx);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(1);

  const toast = useCallback((kind: ToastItem['kind'], title: string, body?: string) => {
    const id = idRef.current++;
    setItems((cur) => [...cur.slice(-4), { id, kind, title, body }]);
    setTimeout(() => setItems((cur) => cur.filter((t) => t.id !== id)), kind === 'error' ? 7000 : 4200);
  }, []);

  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            <div style={{ marginTop: 1, color: `var(--dp-${t.kind === 'error' ? 'error' : t.kind === 'success' ? 'success' : t.kind === 'warning' ? 'warning' : 'info'})` }}>
              {t.kind === 'success' ? <IconCheck size={16} /> : t.kind === 'info' ? <IconInfo size={16} /> : <IconAlert size={16} />}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="toast-title">{t.title}</div>
              {t.body && <div className="toast-body">{t.body}</div>}
            </div>
            <button
              className="btn btn-ghost btn-sm"
              style={{ height: 22, width: 22, padding: 0 }}
              aria-label="Dismiss"
              onClick={() => setItems((cur) => cur.filter((x) => x.id !== t.id))}
            >
              <IconX size={13} />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
