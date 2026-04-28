'use client';

import { useCallback } from 'react';
import { Portal } from '@/components/Portal';
import { useScrollLock } from '@/hooks/useScrollLock';
import { useEscapeKey } from '@/hooks/useEscapeKey';

interface OverlayProps {
  /** Whether the overlay is visible */
  open: boolean;
  /** Called when the backdrop is clicked or Escape is pressed */
  onClose: () => void;
  children: React.ReactNode;
  /** Prevent closing on backdrop click */
  disableBackdropClose?: boolean;
  /** Prevent closing on Escape key */
  disableEscapeClose?: boolean;
  /** Additional class names for the backdrop */
  backdropClassName?: string;
}

/**
 * Base overlay primitive. Renders a full-screen backdrop via a portal,
 * locks body scroll, and handles Escape + backdrop-click dismissal.
 *
 * Does not manage focus — compose with Dialog or Drawer for that.
 */
export function Overlay({
  open,
  onClose,
  children,
  disableBackdropClose = false,
  disableEscapeClose = false,
  backdropClassName,
}: OverlayProps) {
  useScrollLock(open);
  useEscapeKey(onClose, open && !disableEscapeClose);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (disableBackdropClose) return;
      // Only close when clicking the backdrop itself, not its children
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [disableBackdropClose, onClose]
  );

  if (!open) return null;

  return (
    <Portal>
      {/* Backdrop — aria-hidden so screen readers skip it, but it still
          intercepts pointer events. The dialog panel is rendered as a sibling
          so it remains in the accessibility tree. */}
      <div
        className={
          backdropClassName ??
          'fixed inset-0 z-50 bg-black/60 backdrop-blur-sm'
        }
        onClick={handleBackdropClick}
        aria-hidden="true"
        data-testid="overlay-backdrop"
      />
      {children}
    </Portal>
  );
}
