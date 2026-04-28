'use client';

import React, { useState, useEffect } from 'react';
import { useTimeTracking } from '../context/TimeTrackingContext';
import { useLayout } from '../context/LayoutContext';
import { TaskCard } from './TaskCard';
import { TaskDetail } from './TaskDetail';
import { SplitPane } from './SplitPane';

interface TaskListWithDetailProps {
  className?: string;
}

export function TaskListWithDetail({ className = '' }: TaskListWithDetailProps) {
  const { state } = useTimeTracking();
  const { layout, selectTask, setSplitPercentage, closeDetail } = useLayout();
  const [isMobile, setIsMobile] = useState(false);

  // Check if we're on mobile
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 1024); // lg breakpoint
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const selectedTask = layout.selectedTaskId
    ? state.tasks.find(task => task.id === layout.selectedTaskId)
    : null;

  // Enhanced TaskCard that can trigger selection
  const TaskCardWithSelection = ({ task }: { task: any }) => (
    <div
      className={`cursor-pointer transition-all ${
        layout.selectedTaskId === task.id
          ? 'ring-2 ring-blue-500 ring-opacity-50'
          : 'hover:ring-1 hover:ring-neutral-600 hover:ring-opacity-50'
      }`}
      onClick={() => selectTask(task.id)}
    >
      <TaskCard task={task} />
    </div>
  );

  const taskList = (
    <div className="space-y-4 p-4">
      {state.tasks.length === 0 ? (
        <div className="bg-neutral-800/50 border border-neutral-700/50 rounded-xl p-6 min-h-[300px] flex flex-col items-center justify-center text-neutral-500 shadow-xl">
          <p>No tasks registered yet.</p>
          <p className="text-sm mt-2">Click on a task to view details</p>
        </div>
      ) : (
        <div className="space-y-4">
          {state.tasks.map((task) => (
            <TaskCardWithSelection key={task.id} task={task} />
          ))}
        </div>
      )}
    </div>
  );

  const taskDetail = selectedTask ? (
    <TaskDetail task={selectedTask} onClose={closeDetail} />
  ) : (
    <div className="h-full flex items-center justify-center text-neutral-500">
      <div className="text-center">
        <div className="text-6xl mb-4">📋</div>
        <p className="text-lg">Select a task to view details</p>
        <p className="text-sm mt-2">Click on any task in the list</p>
      </div>
    </div>
  );

  // Mobile: Modal overlay
  if (isMobile) {
    return (
      <div className={`space-y-6 ${className}`}>
        {state.tasks.length === 0 ? (
          <div className="bg-neutral-800/50 border border-neutral-700/50 rounded-xl p-6 min-h-[300px] flex flex-col items-center justify-center text-neutral-500 shadow-xl">
            <p>No tasks registered yet.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {state.tasks.map((task) => (
              <TaskCardWithSelection key={task.id} task={task} />
            ))}
          </div>
        )}

        {/* Mobile Modal */}
        {layout.isDetailOpen && selectedTask && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-neutral-800 border border-neutral-700 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden">
              <TaskDetail task={selectedTask} onClose={closeDetail} />
            </div>
          </div>
        )}
      </div>
    );
  }

  // Desktop: Split pane layout
  return (
    <div className={`h-screen ${className}`}>
      <SplitPane
        left={taskList}
        right={taskDetail}
        defaultSplit={layout.splitPercentage}
        minLeftWidth={400}
        minRightWidth={500}
        onSplitChange={setSplitPercentage}
        className="h-full"
      />
    </div>
  );
}