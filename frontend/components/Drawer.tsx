'use client';

import { useId } from 'react';
import { Overlay } from '@/components/Overlay';
import { useFocusTrap } from '@/hooks/useFocusTrap';

export type DrawerSide = 'left' | 'right' | 'bottom';

export interface DrawerProps {
  /** Whether the drawer is open */
  open: boolean;
  /** Called when the drawer should close */
  onClose: () => void;
  /** Accessible title */
  title: string;
  /** Optional description */
  description?: string;
  children: React.ReactNode;
  /** Which edge the drawer slides in from (default: 'right') */
  side?: DrawerSide;
  /** Prevent closing on backdrop click */
  disableBackdropClose?: boolean;
  /** Prevent closing on Escape key */
  disableEscapeClose?: boolean;
  /** Width class for left/right drawers (default: 'w-80') */
  width?: string;
  /** Height class for bottom drawer (default: 'h-[60vh]') */
  height?: string;
}

const PANEL_POSITION: Record<DrawerSide, string> = {
  right: 'right-0 top-0 h-full',
  left: 'left-0 top-0 h-full',
  bottom: 'bottom-0 left-0 w-full',
};

/**
 * Accessible slide-in drawer panel.
 *
 * - Renders into a portal via Overlay
 * - Traps focus within the panel
 * - Restores focus on close
 * - Locks body scroll
 * - Handles Escape and backdrop-click dismissal
 * - Meets ARIA dialog pattern
 */
export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  side = 'right',
  disableBackdropClose,
  disableEscapeClose,
  width = 'w-80',
  height = 'h-[60vh]',
}: DrawerProps) {
  const titleId = useId();
  const descId = useId();
  const panelRef = useFocusTrap<HTMLDivElement>({ enabled: open });

  const sizeClass = side === 'bottom' ? height : width;

  return (
    <Overlay
      open={open}
      onClose={onClose}
      disableBackdropClose={disableBackdropClose}
      disableEscapeClose={disableEscapeClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        className={`absolute ${PANEL_POSITION[side]} ${sizeClass} bg-neutral-900 border-neutral-700/50 flex flex-col shadow-2xl ${
          side === 'right' ? 'border-l' : side === 'left' ? 'border-r' : 'border-t'
        }`}
        data-testid="drawer-panel"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
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
            aria-label="Close drawer"
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

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-4">{children}</div>
      </div>
    </Overlay>
  );
}
