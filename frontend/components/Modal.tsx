'use client';

import { Dialog, DialogFooter } from '@/components/Dialog';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

export interface ModalProps {
  /** Whether the modal is visible */
  open: boolean;
  /** Called when the modal should close */
  onClose: () => void;
  /** Accessible title rendered in the modal header */
  title: string;
  /** Optional description below the title */
  description?: string;
  children: React.ReactNode;
  /** Optional footer content — use ModalFooter for consistent layout */
  footer?: React.ReactNode;
  /** Prevent closing while an async action is in progress */
  isLoading?: boolean;
  /** Max width preset */
  size?: ModalSize;
  /** Hide the built-in title/description header */
  hideHeader?: boolean;
}

/**
 * Generic modal built on the accessible Dialog primitive.
 *
 * Provides a simpler API for feature modals: pass `footer` for action rows and
 * set `isLoading` to block backdrop/Escape dismissal during async work.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  isLoading = false,
  size = 'md',
  hideHeader = false,
}: ModalProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size={size}
      hideHeader={hideHeader}
      disableBackdropClose={isLoading}
      disableEscapeClose={isLoading}
    >
      {children}
      {footer}
    </Dialog>
  );
}

/** Consistent footer layout for modal action buttons */
export function ModalFooter({ children }: { children: React.ReactNode }) {
  return <DialogFooter>{children}</DialogFooter>;
}
