import React, {
  createContext,
  useContext,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type A11yIntent = 'error' | 'warning' | 'success' | 'info';
type A11yIntentCSS = Record<
  A11yIntent,
  { backgroundColor: string; color: string; borderColor: string }
>;

const INTENT_STYLES: A11yIntentCSS = {
  error: { backgroundColor: '#7f1d1d', color: '#fecaca', borderColor: '#991b1b' },
  warning: { backgroundColor: '#78350f', color: '#fde68a', borderColor: '#92400e' },
  success: { backgroundColor: '#14532d', color: '#bbf7d0', borderColor: '#166534' },
  info: { backgroundColor: '#1e3a8a', color: '#bfdbfe', borderColor: '#1e40af' },
};

// ---------------------------------------------------------------------------
// Focus scope
// ---------------------------------------------------------------------------

interface FocusScopeProps {
  children: ReactNode;
  as?: React.ElementType;
}

export function FocusScope({ children, as: Component = 'div' }: FocusScopeProps) {
  const ref = useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const focusable = node.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    focusable?.focus();
  }, []);

  return (
    <Component ref={ref} className="a11y-focus-scope">
      {children}
    </Component>
  );
}

// ---------------------------------------------------------------------------
// Screen reader only
// ---------------------------------------------------------------------------

export function VisuallyHidden({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        position: 'absolute',
        width: '1px',
        height: '1px',
        padding: 0,
        margin: '-1px',
        overflow: 'hidden',
        clip: 'rect(0, 0, 0, 0)',
        whiteSpace: 'nowrap',
        border: 0,
      }}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Skip link
// ---------------------------------------------------------------------------

export function SkipLink({ href = '#main' }: { href?: string }) {
  return (
    <a
      href={href}
      className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-black"
    >
      Skip to main content
    </a>
  );
}

// ---------------------------------------------------------------------------
// Live region
// ---------------------------------------------------------------------------

export function LiveRegion({ message, politeness = 'polite' }: { message: string; politeness?: 'polite' | 'assertive' }) {
  return (
    <div aria-live={politeness} aria-atomic="true" className="sr-only">
      {message}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Alert
// ---------------------------------------------------------------------------

export interface AlertProps {
  intent?: A11yIntent;
  title?: string;
  children: ReactNode;
}

export function Alert({ intent = 'info', title, children }: AlertProps) {
  const styles = INTENT_STYLES[intent];
  return (
    <div
      role="alert"
      style={{
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: styles.borderColor,
        backgroundColor: styles.backgroundColor,
        color: styles.color,
      }}
      className="rounded-lg p-4"
    >
      {title && <p className="font-semibold">{title}</p>}
      <div className="text-sm">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Button (polymorphic)
// ---------------------------------------------------------------------------

type ButtonProps<As extends React.ElementType = 'button'> = {
  as?: As;
  intent?: A11yIntent;
  variant?: 'primary' | 'secondary' | 'ghost';
  loading?: boolean;
  disabled?: boolean;
  children: ReactNode;
} & React.ComponentPropsWithoutRef<As>;

export function Button<As extends React.ElementType = 'button'>({
  as,
  intent,
  variant = 'primary',
  loading,
  disabled,
  children,
  ...rest
}: ButtonProps<As>) {
  const Component = as ?? 'button';
  const base =
    'inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-900 disabled:opacity-50 disabled:cursor-not-allowed';
  const variantClass =
    variant === 'primary'
      ? 'bg-blue-600 text-white hover:bg-blue-500'
      : variant === 'secondary'
        ? 'bg-neutral-800 text-neutral-200 border border-neutral-700 hover:bg-neutral-700'
        : 'bg-transparent text-neutral-300 hover:bg-neutral-800';

  return (
    <Component
      {...(rest as Record<string, unknown>)}
      disabled={disabled || loading}
      aria-busy={loading}
      className={`${base} ${variantClass}`}
    >
      {loading && <span className="mr-2" aria-hidden="true">⏳</span>}
      {children}
    </Component>
  );
}

// ---------------------------------------------------------------------------
// TextField
// ---------------------------------------------------------------------------

export interface TextFieldProps {
  id?: string;
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  disabled?: boolean;
  value?: string;
  onChange?: (value: string) => void;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
}

export function TextField({
  id: providedId,
  label,
  error,
  hint,
  required,
  disabled,
  value,
  onChange,
  type = 'text',
  placeholder,
  autoComplete,
}: TextFieldProps) {
  const generated = useId();
  const id = providedId ?? generated;
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className="mb-4">
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-neutral-300">
        {label}
        {required && <span className="ml-1 text-red-400" aria-hidden="true">*</span>}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        autoComplete={autoComplete}
        aria-invalid={!!error}
        aria-describedby={describedBy}
        className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white placeholder:text-neutral-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:opacity-50"
      />
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-neutral-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-xs text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Screen Reader Context
// ---------------------------------------------------------------------------

interface A11yContextValue {
  announce: (message: string, politeness?: 'polite' | 'assertive') => void;
}

const A11yContext = createContext<A11yContextValue | null>(null);

export function useA11y() {
  const ctx = useContext(A11yContext);
  if (!ctx) throw new Error('useA11y must be used within A11yProvider');
  return ctx;
}

export function A11yProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState('');
  const [politeness, setPoliteness] = useState<'polite' | 'assertive'>('polite');

  const announce = useMemo(
    () =>
      (msg: string, p: 'polite' | 'assertive' = 'polite') => {
        setMessage('');
        setPoliteness(p);
        requestAnimationFrame(() => setMessage(msg));
      },
    []
  );

  return (
    <A11yContext.Provider value={{ announce }}>
      {children}
      <LiveRegion message={message} politeness={politeness} />
    </A11yContext.Provider>
  );
}
