'use client';

import { Dialog, DialogFooter } from '@/components/Dialog';

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: string;
  /** Label for the confirm button (default: 'Confirm') */
  confirmLabel?: string;
  /** Label for the cancel button (default: 'Cancel') */
  cancelLabel?: string;
  /** Visual intent of the confirm button (default: 'danger') */
  intent?: 'danger' | 'primary';
  /** Whether the confirm action is in progress */
  isLoading?: boolean;
}

const CONFIRM_BUTTON_STYLES: Record<NonNullable<ConfirmDialogProps['intent']>, string> = {
  danger: 'bg-red-600 hover:bg-red-500 focus:ring-red-500',
  primary: 'bg-blue-600 hover:bg-blue-500 focus:ring-blue-500',
};

/**
 * Confirmation dialog built on top of Dialog.
 * Provides a consistent pattern for destructive or important actions.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  intent = 'danger',
  isLoading = false,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      disableBackdropClose={isLoading}
      disableEscapeClose={isLoading}
    >
      <DialogFooter>
        <button
          type="button"
          onClick={onClose}
          disabled={isLoading}
          className="px-4 py-2 text-sm font-medium text-neutral-300 bg-neutral-800 rounded-lg hover:bg-neutral-700 transition-colors focus:outline-none focus:ring-2 focus:ring-neutral-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={isLoading}
          className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors focus:outline-none focus:ring-2 disabled:opacity-50 disabled:cursor-not-allowed ${CONFIRM_BUTTON_STYLES[intent]}`}
        >
          {isLoading ? (
            <span className="flex items-center gap-2">
              <svg
                className="w-4 h-4 animate-spin"
                fill="none"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                />
              </svg>
              {confirmLabel}
            </span>
          ) : (
            confirmLabel
          )}
        </button>
      </DialogFooter>
    </Dialog>
  );
}
