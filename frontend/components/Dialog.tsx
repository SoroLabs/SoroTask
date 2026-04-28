'use client';

import { useId } from 'react';
import { Overlay } from '@/components/Overlay';
import { useFocusTrap } from '@/hooks/useFocusTrap';

export interface DialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Called when the dialog should close */
  onClose: () => void;
  /** Accessible title — rendered as the dialog label */
  title: string;
  /** Optional description rendered below the title */
  description?: string;
  children: React.ReactNode;
  /** Prevent closing on backdrop click */
  disableBackdropClose?: boolean;
  /** Prevent closing on Escape key */
  disableEscapeClose?: boolean;
  /** Max width class, e.g. 'max-w-md' (default) or 'max-w-lg' */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Hide the built-in title/description header */
  hideHeader?: boolean;
}

const SIZE_CLASSES: Record<NonNullable<DialogProps['size']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
};

/**
 * Accessible modal dialog.
 *
 * - Renders into a portal via Overlay
 * - Traps focus within the panel
 * - Restores focus on close
 * - Locks body scroll
 * - Handles Escape and backdrop-click dismissal
 * - Meets ARIA dialog pattern (role="dialog", aria-modal, aria-labelledby)
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  disableBackdropClose,
  disableEscapeClose,
  size = 'md',
  hideHeader = false,
}: DialogProps) {
  const titleId = useId();
  const descId = useId();
  const panelRef = useFocusTrap<HTMLDivElement>({ enabled: open });

  return (
    <Overlay
      open={open}
      onClose={onClose}
      disableBackdropClose={disableBackdropClose}
      disableEscapeClose={disableEscapeClose}
      backdropClassName="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
    >
      {/* Centering wrapper — sits above the backdrop, handles backdrop clicks */}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        onClick={!disableBackdropClose ? onClose : undefined}
        data-testid="dialog-centering"
      >
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descId : undefined}
          className={`relative w-full ${SIZE_CLASSES[size]} bg-neutral-900 border border-neutral-700/50 rounded-xl shadow-2xl max-h-[90vh] flex flex-col overflow-hidden`}
          data-testid="dialog-panel"
          onClick={(e) => e.stopPropagation()}
        >
        {!hideHeader && (
          <div className="flex items-start justify-between px-6 py-4 border-b border-neutral-800 flex-shrink-0">
            <div>
              <h2
                id={titleId}
                className="text-lg font-semibold text-neutral-100"
              >
                {title}
              </h2>
              {description && (
                <p id={descId} className="mt-1 text-sm text-neutral-400">
                  {description}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="ml-4 flex-shrink-0 text-neutral-400 hover:text-neutral-200 transition-colors rounded-md p-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-label="Close dialog"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        )}

        <div className="overflow-y-auto flex-1 px-6 py-4">{children}</div>
      </div>
      </div>
    </Overlay>
  );
}

/** Convenience sub-components for consistent dialog footer layout */
export function DialogFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-neutral-800 flex-shrink-0">
      {children}
    </div>
  );
}
