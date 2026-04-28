"use client";

import { useMemo, useState } from "react";
import { useUnsavedChangesGuard } from "../hooks/useUnsavedChangesGuard";

type TaskDraft = {
  target: string;
  functionName: string;
  intervalSeconds: string;
  gasBalance: string;
  description: string;
  commentTemplate: string;
};

type SettingsDraft = {
  webhookUrl: string;
  autoRetry: boolean;
  retryBackoffSeconds: string;
};

const EMPTY_TASK: TaskDraft = {
  target: "",
  functionName: "",
  intervalSeconds: "",
  gasBalance: "",
  description: "",
  commentTemplate: "",
};

const EMPTY_SETTINGS: SettingsDraft = {
  webhookUrl: "",
  autoRetry: false,
  retryBackoffSeconds: "30",
};

function serialize(value: unknown): string {
  return JSON.stringify(value);
}

export default function TaskWorkspace() {
  const [taskDraft, setTaskDraft] = useState<TaskDraft>(EMPTY_TASK);
  const [savedTaskDraft, setSavedTaskDraft] = useState<TaskDraft>(EMPTY_TASK);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<SettingsDraft>(EMPTY_SETTINGS);
  const [savedSettingsDraft, setSavedSettingsDraft] = useState<SettingsDraft>(EMPTY_SETTINGS);

  const taskIsDirty = useMemo(
    () => serialize(taskDraft) !== serialize(savedTaskDraft),
    [taskDraft, savedTaskDraft],
  );

  const settingsIsDirty = useMemo(
    () => serialize(settingsDraft) !== serialize(savedSettingsDraft),
    [settingsDraft, savedSettingsDraft],
  );

  const { confirmDiscard } = useUnsavedChangesGuard({
    isDirty: taskIsDirty || (settingsOpen && settingsIsDirty),
  });

  const closeSettings = () => {
    if (settingsIsDirty && !window.confirm("Discard unsaved settings changes?")) {
      return;
    }
    setSettingsOpen(false);
  };

  const saveTaskDraft = () => {
    setSavedTaskDraft(taskDraft);
  };

  const resetTaskDraft = () => {
    if (taskIsDirty && !confirmDiscard()) {
      return;
    }
    setTaskDraft(savedTaskDraft);
  };

  const saveSettingsDraft = () => {
    setSavedSettingsDraft(settingsDraft);
    setSettingsOpen(false);
  };

  const resetSettingsDraft = () => {
    if (settingsIsDirty && !window.confirm("Discard unsaved settings changes?")) {
      return;
    }
    setSettingsDraft(savedSettingsDraft);
  };

  return (
    <div className="min-h-screen bg-neutral-900 text-neutral-100 font-sans">
      <header className="border-b border-neutral-800 bg-neutral-950/50 backdrop-blur-md sticky top-0 z-10">
        <div className="container mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center font-bold text-white shadow-lg shadow-blue-500/20">S</div>
            <h1 className="text-xl font-bold tracking-tight">SoroTask</h1>
          </div>
          <button
            className="bg-neutral-100 text-neutral-900 px-4 py-2 rounded-md font-medium hover:bg-neutral-200 transition-colors"
            onClick={() => setSettingsOpen(true)}
            type="button"
          >
            Settings
          </button>
        </div>
      </header>

      <main className="container mx-auto px-6 py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
          <section className="space-y-6">
            <h2 className="text-2xl font-bold">Create Automation Task</h2>
            <div className="bg-neutral-800/50 border border-neutral-700/50 rounded-xl p-6 space-y-4 shadow-xl">
              <div>
                <label className="block text-sm font-medium text-neutral-400 mb-1">Target Contract Address</label>
                <input
                  data-testid="target-input"
                  type="text"
                  placeholder="C..."
                  value={taskDraft.target}
                  onChange={(event) => setTaskDraft((current) => ({ ...current, target: event.target.value }))}
                  className="w-full bg-neutral-900 border border-neutral-700/50 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all font-mono text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-neutral-400 mb-1">Function Name</label>
                <input
                  type="text"
                  placeholder="harvest_yield"
                  value={taskDraft.functionName}
                  onChange={(event) => setTaskDraft((current) => ({ ...current, functionName: event.target.value }))}
                  className="w-full bg-neutral-900 border border-neutral-700/50 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all font-mono text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-neutral-400 mb-1">Interval (seconds)</label>
                  <input
                    type="number"
                    placeholder="3600"
                    value={taskDraft.intervalSeconds}
                    onChange={(event) => setTaskDraft((current) => ({ ...current, intervalSeconds: event.target.value }))}
                    className="w-full bg-neutral-900 border border-neutral-700/50 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-neutral-400 mb-1">Gas Balance (XLM)</label>
                  <input
                    type="number"
                    placeholder="10"
                    value={taskDraft.gasBalance}
                    onChange={(event) => setTaskDraft((current) => ({ ...current, gasBalance: event.target.value }))}
                    className="w-full bg-neutral-900 border border-neutral-700/50 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all font-mono text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-neutral-400 mb-1">Description</label>
                <textarea
                  rows={3}
                  value={taskDraft.description}
                  onChange={(event) => setTaskDraft((current) => ({ ...current, description: event.target.value }))}
                  className="w-full bg-neutral-900 border border-neutral-700/50 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-neutral-400 mb-1">Comment Template</label>
                <textarea
                  rows={4}
                  value={taskDraft.commentTemplate}
                  onChange={(event) => setTaskDraft((current) => ({ ...current, commentTemplate: event.target.value }))}
                  className="w-full bg-neutral-900 border border-neutral-700/50 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-sm font-mono"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-medium py-3 rounded-lg transition-colors shadow-lg shadow-blue-600/20"
                  onClick={saveTaskDraft}
                  type="button"
                >
                  Save Draft
                </button>
                <button
                  className="flex-1 bg-neutral-700 hover:bg-neutral-600 text-white font-medium py-3 rounded-lg transition-colors"
                  onClick={resetTaskDraft}
                  type="button"
                >
                  Reset
                </button>
              </div>
              <p data-testid="dirty-state" className="text-xs text-neutral-400">
                {taskIsDirty ? "Unsaved changes" : "All changes saved"}
              </p>
            </div>
          </section>

          <section className="space-y-6">
            <h2 className="text-2xl font-bold">Your Tasks</h2>
            <div className="bg-neutral-800/50 border border-neutral-700/50 rounded-xl p-6 min-h-[300px] flex flex-col items-center justify-center text-neutral-500 shadow-xl">
              <p>No tasks registered yet.</p>
            </div>
          </section>
        </div>
      </main>

      {settingsOpen ? (
        <div className="fixed inset-0 z-20 flex items-center justify-center" role="dialog" aria-modal="true">
          <button
            aria-label="Close settings backdrop"
            className="absolute inset-0 bg-black/60"
            onClick={closeSettings}
            type="button"
          />
          <div className="relative w-full max-w-lg bg-neutral-900 border border-neutral-700 rounded-xl p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-semibold">Automation Settings</h3>
              <button
                aria-label="Close settings"
                className="text-neutral-400 hover:text-neutral-200"
                onClick={closeSettings}
                type="button"
              >
                x
              </button>
            </div>
            <div>
              <label htmlFor="settings-webhook-url" className="block text-sm font-medium text-neutral-400 mb-1">Webhook URL</label>
              <input
                id="settings-webhook-url"
                type="text"
                value={settingsDraft.webhookUrl}
                onChange={(event) => setSettingsDraft((current) => ({ ...current, webhookUrl: event.target.value }))}
                className="w-full bg-neutral-950 border border-neutral-700 rounded-lg px-4 py-2 outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-neutral-200">
              <input
                type="checkbox"
                checked={settingsDraft.autoRetry}
                onChange={(event) => setSettingsDraft((current) => ({ ...current, autoRetry: event.target.checked }))}
              />
              Enable auto retry
            </label>
            <div>
              <label htmlFor="settings-retry-backoff" className="block text-sm font-medium text-neutral-400 mb-1">Retry backoff (seconds)</label>
              <input
                id="settings-retry-backoff"
                type="number"
                value={settingsDraft.retryBackoffSeconds}
                onChange={(event) => setSettingsDraft((current) => ({ ...current, retryBackoffSeconds: event.target.value }))}
                className="w-full bg-neutral-950 border border-neutral-700 rounded-lg px-4 py-2 outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex gap-3 pt-2">
              <button className="flex-1 bg-blue-600 hover:bg-blue-500 rounded-lg py-2" onClick={saveSettingsDraft} type="button">
                Save Settings
              </button>
              <button className="flex-1 bg-neutral-700 hover:bg-neutral-600 rounded-lg py-2" onClick={resetSettingsDraft} type="button">
                Reset
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
