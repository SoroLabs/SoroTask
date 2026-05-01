"use client";

import { useEffect, useRef, useState, useCallback, type ReactNode } from "react";
import { useLayoutStore } from "@/src/store/layoutStore";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import TaskDetailPane from "./TaskDetailPane";

// ── Types ─────────────────────────────────────────────────────────────────────

interface SplitPaneLayoutProps {
  children: ReactNode;
}

// ── Breakpoint detection hook ────────────────────────────────────────────────

type Breakpoint = "mobile" | "tablet" | "desktop";

function useBreakpoint(): Breakpoint {
  const [breakpoint, setBreakpoint] = useState<Breakpoint>("desktop");

  useEffect(() => {
    const updateBreakpoint = () => {
      const width = window.innerWidth;
      if (width < 768) {
        setBreakpoint("mobile");
      } else if (width < 1024) {
        setBreakpoint("tablet");
      } else {
        setBreakpoint("desktop");
      }
    };

    updateBreakpoint();
    window.addEventListener("resize", updateBreakpoint);
    return () => window.removeEventListener("resize", updateBreakpoint);
  }, []);

  return breakpoint;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SplitPaneLayout({ children }: SplitPaneLayoutProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const breakpoint = useBreakpoint();

  const {
    selectedTaskId,
    detailPaneWidth,
    openDetailPane,
    closeDetailPane,
    setDetailPaneWidth,
  } = useLayoutStore();

  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastFocusedElementRef = useRef<HTMLElement | null>(null);

  // ── URL sync ──────────────────────────────────────────────────────────────

  // On mount, check if URL has selected= param and open pane
  useEffect(() => {
    const selectedParam = searchParams.get("selected");
    if (selectedParam && selectedParam !== selectedTaskId) {
      openDetailPane(selectedParam);
    } else if (!selectedParam && selectedTaskId) {
      closeDetailPane();
    }
  }, [searchParams, selectedTaskId, openDetailPane, closeDetailPane]);

  // Update URL when selectedTaskId changes
  useEffect(() => {
    const currentSelected = searchParams.get("selected");
    
    if (selectedTaskId && currentSelected !== selectedTaskId) {
      const params = new URLSearchParams(searchParams.toString());
      params.set("selected", selectedTaskId);
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    } else if (!selectedTaskId && currentSelected) {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("selected");
      const newUrl = params.toString() ? `${pathname}?${params}` : pathname;
      router.push(newUrl, { scroll: false });
    }
  }, [selectedTaskId, pathname, searchParams, router]);

  // ── Resize handle logic ───────────────────────────────────────────────────

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging || !containerRef.current) return;

      const containerRect = containerRef.current.getBoundingClientRect();
      const offsetX = e.clientX - containerRect.left;
      const newDetailWidth = ((containerRect.width - offsetX) / containerRect.width) * 100;

      // Enforce minimum widths: 320px for list, 300px for detail
      const minListWidth = (320 / containerRect.width) * 100;
      const minDetailWidth = (300 / containerRect.width) * 100;

      const clampedWidth = Math.max(
        minDetailWidth,
        Math.min(100 - minListWidth, newDetailWidth)
      );

      setDetailPaneWidth(clampedWidth);
    },
    [isDragging, setDetailPaneWidth]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleDoubleClick = useCallback(() => {
    setDetailPaneWidth(40); // Reset to default 60/40
  }, [setDetailPaneWidth]);

  useEffect(() => {
    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      return () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  // ── Close handlers ────────────────────────────────────────────────────────

  const handleClose = useCallback(() => {
    closeDetailPane();
    
    // Return focus to the last focused element
    if (lastFocusedElementRef.current) {
      lastFocusedElementRef.current.focus();
      lastFocusedElementRef.current = null;
    }
  }, [closeDetailPane]);

  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && selectedTaskId) {
        handleClose();
      }
    },
    [selectedTaskId, handleClose]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [handleEscape]);

  // Save focus when pane opens
  useEffect(() => {
    if (selectedTaskId && document.activeElement instanceof HTMLElement) {
      lastFocusedElementRef.current = document.activeElement;
    }
  }, [selectedTaskId]);

  // ── Render ────────────────────────────────────────────────────────────────

  const isPaneOpen = Boolean(selectedTaskId);
  const isDesktop = breakpoint === "desktop";
  const isTablet = breakpoint === "tablet";
  const isMobile = breakpoint === "mobile";

  // Determine layout mode
  const showSplitPane = isDesktop && isPaneOpen;
  const showDrawer = isTablet && isPaneOpen;
  const showSheet = isMobile && isPaneOpen;

  // Calculate widths for desktop split-pane
  const listWidth = showSplitPane ? 100 - detailPaneWidth : 100;

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden">
      {/* Main content (list/board) */}
      <div
        className={`
          h-full transition-all duration-300
          ${showSplitPane ? "" : "w-full"}
          ${showDrawer || showSheet ? "pointer-events-none" : ""}
        `}
        style={showSplitPane ? { width: `${listWidth}%` } : undefined}
        aria-hidden={showDrawer || showSheet}
      >
        {children}
      </div>

      {/* Resize handle (desktop only) */}
      {showSplitPane && (
        <div
          className={`
            absolute top-0 bottom-0 w-1 cursor-col-resize
            hover:bg-primary-500 transition-colors
            ${isDragging ? "bg-primary-500" : "bg-neutral-700"}
          `}
          style={{ left: `${listWidth}%` }}
          onMouseDown={handleMouseDown}
          onDoubleClick={handleDoubleClick}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize task detail pane"
        />
      )}

      {/* Detail pane - desktop split */}
      {showSplitPane && (
        <div
          className="absolute top-0 right-0 bottom-0 h-full overflow-hidden border-l border-neutral-700"
          style={{ width: `${detailPaneWidth}%` }}
        >
          <TaskDetailPane taskId={selectedTaskId!} onClose={handleClose} />
        </div>
      )}

      {/* Detail pane - tablet drawer */}
      {showDrawer && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/50 z-40 transition-opacity duration-300"
            onClick={handleClose}
            aria-hidden="true"
          />
          {/* Drawer */}
          <div
            className="fixed top-0 right-0 bottom-0 w-[420px] bg-neutral-900 border-l border-neutral-700 z-50 shadow-2xl"
            style={{
              animation: "slideInRight 300ms ease-out",
            }}
          >
            <TaskDetailPane taskId={selectedTaskId!} onClose={handleClose} />
          </div>
        </>
      )}

      {/* Detail pane - mobile sheet */}
      {showSheet && (
        <div
          className="fixed inset-0 bg-neutral-900 z-50"
          style={{
            animation: "slideInRight 300ms ease-out",
          }}
        >
          <TaskDetailPane taskId={selectedTaskId!} onClose={handleClose} showBackButton />
        </div>
      )}

      <style jsx>{`
        @keyframes slideInRight {
          from {
            transform: translateX(100%);
          }
          to {
            transform: translateX(0);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          * {
            animation-duration: 0.01ms !important;
            transition-duration: 0.01ms !important;
          }
        }
      `}</style>
    </div>
  );
}
