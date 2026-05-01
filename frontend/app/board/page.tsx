"use client";

import { useEffect, useRef } from "react";
import { useLayoutStore } from "@/src/store/layoutStore";
import SplitPaneLayout from "@/src/components/layout/SplitPaneLayout";
import Board from "@/components/board/Board";

export default function BoardPage() {
  const { boardScrollPositions, saveBoardScrollPosition } = useLayoutStore();
  const boardRef = useRef<HTMLDivElement>(null);

  // Restore scroll positions for board columns
  useEffect(() => {
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
        <div className="px-6 py-4 border-b border-neutral-700 flex-shrink-0">
          <h1 className="text-2xl font-bold text-neutral-100 mb-2">Board</h1>
          <p className="text-sm text-neutral-400">
            Organize your tasks with drag and drop
          </p>
        </div>

        {/* Board */}
        <div ref={boardRef} className="flex-1 overflow-y-auto px-6 py-6">
          <Board />
        </div>
      </div>
    </SplitPaneLayout>
  );
}
