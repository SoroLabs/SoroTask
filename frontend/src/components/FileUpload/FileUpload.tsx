'use client';

import {
  useCallback,
  useRef,
  useState,
  DragEvent,
  ChangeEvent,
  KeyboardEvent,
} from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export type FileStatus = 'pending' | 'uploading' | 'success' | 'error';

export interface FileItem {
  id: string;
  file: File;
  status: FileStatus;
  progress: number;
  errorMessage?: string;
}

export interface FileUploadProps {
  /**
   * Accepted MIME types. Supports wildcards, e.g. 'image/*'.
   * Omit to accept any file type.
   */
  accept?: string[];
  /** Maximum size per file in bytes. Default: 10 MB. */
  maxSizeBytes?: number;
  /** Maximum number of files. Default: 5. */
  maxFiles?: number;
  /**
   * Called once per valid file. Receives the file and a progress callback (0–100).
   * Resolve to indicate success; throw to indicate failure.
   * Omit to run a built-in simulation (useful for demos / Storybook).
   */
  onUpload?: (file: File, onProgress: (pct: number) => void) => Promise<void>;
  /** Fires whenever the file list changes. */
  onFilesChange?: (files: FileItem[]) => void;
  className?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

const TEN_MB = 10 * 1_024 * 1_024;

// ─── Component ────────────────────────────────────────────────────────────────

export function FileUpload({
  accept,
  maxSizeBytes = TEN_MB,
  maxFiles = 5,
  onUpload,
  onFilesChange,
  className = '',
}: FileUploadProps) {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── State helpers ───────────────────────────────────────────────────────────

  const updateFiles = useCallback(
    (updater: (prev: FileItem[]) => FileItem[]) => {
      setFiles((prev) => {
        const next = updater(prev);
        onFilesChange?.(next);
        return next;
      });
    },
    [onFilesChange],
  );

  // ── Upload logic ────────────────────────────────────────────────────────────

  const startUpload = useCallback(
    async (id: string, file: File) => {
      updateFiles((prev) =>
        prev.map((f) =>
          f.id === id
            ? { ...f, status: 'uploading', progress: 0, errorMessage: undefined }
            : f,
        ),
      );

      if (!onUpload) {
        // Built-in simulation for demos / Storybook.
        for (const pct of [0, 25, 50, 75, 100]) {
          await new Promise<void>((res) => setTimeout(res, 200));
          updateFiles((prev) =>
            prev.map((f) => (f.id === id ? { ...f, progress: pct } : f)),
          );
        }
        updateFiles((prev) =>
          prev.map((f) =>
            f.id === id ? { ...f, status: 'success', progress: 100 } : f,
          ),
        );
        return;
      }

      try {
        await onUpload(file, (pct) => {
          updateFiles((prev) =>
            prev.map((f) => (f.id === id ? { ...f, progress: pct } : f)),
          );
        });
        updateFiles((prev) =>
          prev.map((f) =>
            f.id === id ? { ...f, status: 'success', progress: 100 } : f,
          ),
        );
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Upload failed. Please try again.';
        updateFiles((prev) =>
          prev.map((f) => (f.id === id ? { ...f, status: 'error', errorMessage } : f)),
        );
      }
    },
    [onUpload, updateFiles],
  );

  // ── Validation ──────────────────────────────────────────────────────────────

  const validate = useCallback(
    (incoming: File[]): { valid: File[]; errors: string[] } => {
      const errors: string[] = [];
      const slotsLeft = maxFiles - files.length;

      if (slotsLeft <= 0) {
        return {
          valid: [],
          errors: [
            `Maximum of ${maxFiles} file${maxFiles !== 1 ? 's' : ''} already reached.`,
          ],
        };
      }

      if (incoming.length > slotsLeft) {
        errors.push(
          `Only ${slotsLeft} more file${slotsLeft !== 1 ? 's' : ''} can be added (max ${maxFiles}).`,
        );
      }

      const valid: File[] = [];
      for (const file of incoming.slice(0, slotsLeft)) {
        if (accept && accept.length > 0) {
          const allowed = accept.some((pattern) => {
            if (pattern.endsWith('/*'))
              return file.type.startsWith(pattern.slice(0, -1));
            return file.type === pattern;
          });
          if (!allowed) {
            errors.push(`"${file.name}" has an unsupported file type.`);
            continue;
          }
        }
        if (file.size > maxSizeBytes) {
          errors.push(
            `"${file.name}" is ${formatBytes(file.size)}, exceeding the ${formatBytes(maxSizeBytes)} limit.`,
          );
          continue;
        }
        valid.push(file);
      }

      return { valid, errors };
    },
    [files, accept, maxFiles, maxSizeBytes],
  );

  // ── File processing ─────────────────────────────────────────────────────────

  const processFiles = useCallback(
    (incoming: File[]) => {
      setValidationErrors([]);
      const { valid, errors } = validate(incoming);
      if (errors.length) setValidationErrors(errors);
      if (valid.length === 0) return;

      const newItems: FileItem[] = valid.map((file) => ({
        id: uid(),
        file,
        status: 'pending',
        progress: 0,
      }));

      updateFiles((prev) => [...prev, ...newItems]);
      for (const item of newItems) startUpload(item.id, item.file);
    },
    [validate, updateFiles, startUpload],
  );

  // ── Drag handlers ───────────────────────────────────────────────────────────

  const onDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  const onDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
  }, []);

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragging(false);
      // Always process (validate) so the user gets an error when the zone is full
      // rather than the drop silently doing nothing.
      processFiles(Array.from(e.dataTransfer.files));
    },
    [processFiles],
  );

  const onInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      processFiles(Array.from(e.target.files ?? []));
      e.target.value = '';
    },
    [processFiles],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        inputRef.current?.click();
      }
    },
    [],
  );

  // ── File actions ────────────────────────────────────────────────────────────

  const removeFile = useCallback(
    (id: string) => updateFiles((prev) => prev.filter((f) => f.id !== id)),
    [updateFiles],
  );

  const retryFile = useCallback(
    (id: string) => {
      const item = files.find((f) => f.id === id);
      if (item) startUpload(id, item.file);
    },
    [files, startUpload],
  );

  // ── Derived values ──────────────────────────────────────────────────────────

  const isFull = files.length >= maxFiles;
  const acceptAttr = accept?.join(',');
  const constraintParts = [
    accept?.length ? `Accepted: ${accept.join(', ')}` : null,
    `Max size: ${formatBytes(maxSizeBytes)}`,
    `Max files: ${maxFiles}`,
  ].filter(Boolean);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className={`space-y-4 ${className}`}>
      {/* ── Drop Zone ────────────────────────────────────────────────────── */}
      <div
        role="button"
        tabIndex={isFull ? -1 : 0}
        aria-disabled={isFull}
        aria-label="File upload area. Click or drag and drop files here."
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => !isFull && inputRef.current?.click()}
        onKeyDown={onKeyDown}
        className={[
          'flex flex-col items-center justify-center gap-3',
          'rounded-xl border-2 border-dashed px-6 py-10',
          'cursor-pointer select-none transition-all duration-200',
          'focus-visible:outline-none focus-visible:ring-2',
          'focus-visible:ring-blue-500 focus-visible:ring-offset-2',
          'focus-visible:ring-offset-neutral-900',
          dragging
            ? 'scale-[1.01] border-blue-400 bg-blue-500/10'
            : isFull
              ? 'cursor-not-allowed border-neutral-700 bg-neutral-800/20 opacity-50'
              : 'border-neutral-700 bg-neutral-800/30 hover:border-blue-500 hover:bg-blue-500/5',
        ].join(' ')}
      >
        <div
          className={`rounded-full p-3 transition-colors ${
            dragging ? 'bg-blue-500/20' : 'bg-neutral-700/50'
          }`}
        >
          <UploadIcon
            className={`h-6 w-6 ${dragging ? 'text-blue-400' : 'text-neutral-400'}`}
          />
        </div>

        <div className="text-center">
          <p className="text-sm font-medium text-neutral-200">
            {dragging ? 'Drop files here' : 'Click or drag files to upload'}
          </p>
          {isFull ? (
            <p className="mt-1 text-xs text-neutral-500">
              Maximum file count reached
            </p>
          ) : (
            <p className="mt-1 text-xs text-neutral-500">
              {constraintParts.join(' · ')}
            </p>
          )}
        </div>
      </div>

      {/* ── Hidden file input ─────────────────────────────────────────────── */}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={acceptAttr}
        onChange={onInputChange}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
      />

      {/* ── Validation errors ─────────────────────────────────────────────── */}
      {validationErrors.length > 0 && (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-lg border border-red-500/30 bg-red-500/10 p-4"
        >
          <div className="flex items-start gap-2">
            <ErrorIcon className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
            <ul className="flex-1 space-y-1">
              {validationErrors.map((err, i) => (
                <li key={i} className="text-sm text-red-300">
                  {err}
                </li>
              ))}
            </ul>
            <button
              onClick={() => setValidationErrors([])}
              aria-label="Dismiss errors"
              className="text-red-400 transition-colors hover:text-red-200"
            >
              <CloseIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* ── File list ─────────────────────────────────────────────────────── */}
      {files.length > 0 && (
        <ul className="space-y-2" aria-label="Uploaded files">
          {files.map((item) => (
            <FileRow
              key={item.id}
              item={item}
              onRemove={removeFile}
              onRetry={retryFile}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── FileRow ──────────────────────────────────────────────────────────────────

interface FileRowProps {
  item: FileItem;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
}

function FileRow({ item, onRemove, onRetry }: FileRowProps) {
  const { id, file, status, progress, errorMessage } = item;
  const isUploading = status === 'uploading';

  return (
    <li className="rounded-lg border border-neutral-700/50 bg-neutral-800/40 px-4 py-3">
      <div className="flex items-center gap-3">
        {/* Icon */}
        <FileIcon className="h-5 w-5 shrink-0 text-neutral-400" />

        {/* Name + size */}
        <div className="min-w-0 flex-1">
          <p
            className="truncate text-sm font-medium text-neutral-200"
            title={file.name}
          >
            {file.name}
          </p>
          <p className="text-xs text-neutral-500">{formatBytes(file.size)}</p>
        </div>

        {/* Status badge */}
        <StatusBadge status={status} />

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-1">
          {status === 'error' && (
            <button
              onClick={() => onRetry(id)}
              aria-label={`Retry upload for ${file.name}`}
              title="Retry"
              className="rounded p-1.5 text-neutral-400 transition-colors hover:bg-neutral-700 hover:text-blue-400"
            >
              <RetryIcon className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={() => onRemove(id)}
            aria-label={`Remove ${file.name}`}
            title="Remove"
            disabled={isUploading}
            className="rounded p-1.5 text-neutral-400 transition-colors hover:bg-neutral-700 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Progress bar */}
      {isUploading && (
        <div className="mt-2">
          <div
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Upload progress for ${file.name}`}
            className="h-1 w-full overflow-hidden rounded-full bg-neutral-700"
          >
            <div
              className="h-full rounded-full bg-blue-500 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Error message */}
      {status === 'error' && errorMessage && (
        <p className="mt-1.5 text-xs text-red-400">{errorMessage}</p>
      )}
    </li>
  );
}

// ─── StatusBadge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: FileStatus }) {
  const configs: Record<FileStatus, { label: string; className: string }> = {
    pending: {
      label: 'Pending',
      className: 'border-neutral-600 bg-neutral-700/60 text-neutral-400',
    },
    uploading: {
      label: 'Uploading…',
      className: 'border-blue-500/20 bg-blue-500/10 text-blue-400',
    },
    success: {
      label: 'Done',
      className: 'border-green-500/20 bg-green-500/10 text-green-400',
    },
    error: {
      label: 'Failed',
      className: 'border-red-500/20 bg-red-500/10 text-red-400',
    },
  };

  const { label, className } = configs[status];

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${className}`}
    >
      {label}
    </span>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function UploadIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5"
      />
    </svg>
  );
}

function FileIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
      />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  );
}

function ErrorIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"
      />
    </svg>
  );
}

function RetryIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"
      />
    </svg>
  );
}