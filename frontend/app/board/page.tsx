"use client";

import { useEffect, useRef, Suspense, useState } from "react";
import { useLayoutStore } from "@/src/store/layoutStore";
import SplitPaneLayout from "@/src/components/layout/SplitPaneLayout";
import Board from "@/components/board/Board";
import { createPerformanceMonitor, afterNextPaint } from "@/src/lib/frontend-performance";
import { MultisigModal } from "@/src/components/MultisigModal";

const monitor = createPerformanceMonitor({ route: "/board" });

function BoardPageContent() {
  const { boardScrollPositions, saveBoardScrollPosition } = useLayoutStore();
  const boardRef = useRef<HTMLDivElement>(null);
  const finishRouteLoad = useRef(monitor.start("route_load"));
  const [multisigOpen, setMultisigOpen] = useState(false);

  // Restore scroll positions for board columns
  useEffect(() => {
    afterNextPaint(() => finishRouteLoad.current());
    if (boardRef.current) {
      const columns = boardRef.current.querySelectorAll('[data-column-id]');
      columns.forEach((column) => {
        const columnId = column.getAttribute('data-column-id');
        if (columnId && boardScrollPositions[columnId]) {
          column.scrollTop = boardScrollPositions[columnId];
        }
      });
    }
  }, [boardScrollPositions]);

  return (
    <SplitPaneLayout>
      <div className="h-full flex flex-col bg-neutral-950">
        {/* Header */}
        <div
          data-onboarding="board"
          className="px-6 py-4 border-b border-neutral-700 flex-shrink-0"
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-neutral-100 mb-2">Board</h1>
              <p className="text-sm text-neutral-400">
                Organize your tasks with drag and drop
              </p>
            </div>
            <button
              type="button"
              onClick={() => setMultisigOpen(true)}
              className="rounded-lg border border-blue-500/40 bg-blue-500/10 px-4 py-2 text-sm font-medium text-blue-200 transition hover:bg-blue-500/20"
            >
              Multi-Sig Proposals
            </button>
          </div>
        </div>

        {/* Board */}
        <div ref={boardRef} className="flex-1 overflow-y-auto px-6 py-6">
          <Board />
        </div>
      </div>
      <MultisigModal
        open={multisigOpen}
        onClose={() => setMultisigOpen(false)}
      />
    </SplitPaneLayout>
  );
}

export default function BoardPage() {
  return (
    <Suspense fallback={<div className="h-full flex items-center justify-center text-neutral-400">Loading...</div>}>
      <BoardPageContent />
    </Suspense>
  );
}
