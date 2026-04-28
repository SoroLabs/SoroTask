import React, { useState } from 'react';
import { HistoryEvent, FieldChange } from '../../types';
import { useHistory } from '../../context/history/HistoryContext';
import { RelativeTimeDisplay } from './RelativeTimeDisplay';

interface TaskHistoryProps {
  taskId: string;
  isOpen: boolean;
  onClose: () => void;
}

export function TaskHistory({ taskId, isOpen, onClose }: TaskHistoryProps) {
  const { getTaskHistory, generateDiff } = useHistory();
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set());

  if (!isOpen) return null;

  const history = getTaskHistory(taskId);

  const toggleExpanded = (eventId: string) => {
    const newExpanded = new Set(expandedEvents);
    if (newExpanded.has(eventId)) {
      newExpanded.delete(eventId);
    } else {
      newExpanded.add(eventId);
    }
    setExpandedEvents(newExpanded);
  };

  const formatFieldName = (field: string): string => {
    const fieldNames: Record<string, string> = {
      functionName: 'Function Name',
      contractAddress: 'Contract Address',
      interval: 'Interval',
      gasBalance: 'Gas Balance',
      description: 'Description',
      status: 'Status',
      assignee: 'Assignee',
    };
    return fieldNames[field] || field;
  };

  const formatValue = (value: any, fieldType: string): string => {
    if (value === null || value === undefined) return 'None';

    switch (fieldType) {
      case 'number':
        return value.toString();
      case 'boolean':
        return value ? 'Yes' : 'No';
      case 'date':
        return new Date(value).toLocaleString();
      case 'text':
        return value.length > 50 ? `${value.substring(0, 50)}...` : value;
      default:
        return String(value);
    }
  };

  const renderFieldChange = (change: FieldChange, eventId: string) => {
    const isExpanded = expandedEvents.has(eventId);

    if (change.fieldType === 'text' && change.oldValue && change.newValue) {
      const diff = generateDiff(change.oldValue, change.newValue);

      if (diff.hasChanges) {
        return (
          <div className="mt-2 p-3 bg-neutral-900 rounded border border-neutral-700">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-neutral-300">
                {formatFieldName(change.field)}
              </span>
              <button
                onClick={() => toggleExpanded(eventId)}
                className="text-xs text-blue-400 hover:text-blue-300"
              >
                {isExpanded ? 'Hide' : 'Show'} Changes
              </button>
            </div>

            {isExpanded && (
              <div className="space-y-2">
                {diff.removed.length > 0 && (
                  <div>
                    <span className="text-xs text-red-400 font-medium">Removed:</span>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {diff.removed.map((word, index) => (
                        <span key={index} className="px-2 py-1 bg-red-500/20 text-red-300 rounded text-xs">
                          {word}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {diff.added.length > 0 && (
                  <div>
                    <span className="text-xs text-green-400 font-medium">Added:</span>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {diff.added.map((word, index) => (
                        <span key={index} className="px-2 py-1 bg-green-500/20 text-green-300 rounded text-xs">
                          {word}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      }
    }

    return (
      <div className="mt-2 p-3 bg-neutral-900 rounded border border-neutral-700">
        <div className="text-sm">
          <span className="font-medium text-neutral-300">{formatFieldName(change.field)}:</span>
          <div className="mt-1 space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xs text-red-400">Before:</span>
              <span className="text-neutral-400 line-through">
                {formatValue(change.oldValue, change.fieldType)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-green-400">After:</span>
              <span className="text-neutral-200">
                {formatValue(change.newValue, change.fieldType)}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const getEventIcon = (eventType: string) => {
    switch (eventType) {
      case 'created': return '🎯';
      case 'field_changed': return '✏️';
      case 'time_logged': return '⏱️';
      case 'comment_added': return '💬';
      case 'status_changed': return '🔄';
      case 'assigned': return '👤';
      case 'unassigned': return '🚫';
      default: return '📝';
    }
  };

  const getEventDescription = (event: HistoryEvent) => {
    switch (event.eventType) {
      case 'created':
        return 'Task was created';
      case 'field_changed':
        return `Changed ${event.changes.length} field${event.changes.length > 1 ? 's' : ''}`;
      case 'time_logged':
        return 'Time was logged';
      case 'comment_added':
        return 'Comment was added';
      case 'status_changed':
        return 'Status was updated';
      case 'assigned':
        return 'Task was assigned';
      case 'unassigned':
        return 'Task was unassigned';
      default:
        return event.description || 'Unknown event';
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-neutral-800 border border-neutral-700 rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-neutral-700">
          <h2 className="text-xl font-semibold">Task History</h2>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-200 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {history.length === 0 ? (
            <div className="text-center text-neutral-500 py-8">
              No history available for this task.
            </div>
          ) : (
            <div className="space-y-4">
              {history.map((event) => (
                <div key={event.id} className="border border-neutral-700 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <div className="text-2xl">{getEventIcon(event.eventType)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-medium text-neutral-200">{event.actorName}</span>
                        <span className="text-neutral-400">•</span>
                        <RelativeTimeDisplay timestamp={event.timestamp} />
                      </div>

                      <div className="text-neutral-300 mb-3">
                        {getEventDescription(event)}
                      </div>

                      {event.changes.map((change, index) => (
                        <div key={index}>
                          {renderFieldChange(change, event.id)}
                        </div>
                      ))}

                      {event.description && (
                        <div className="mt-3 p-3 bg-neutral-900/50 rounded border border-neutral-700">
                          <div className="text-sm text-neutral-300">{event.description}</div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}