import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { FileUpload, formatBytes } from '../FileUpload';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFile(name: string, size: number, type: string): File {
  const content = 'x'.repeat(size);
  return new File([content], name, { type });
}

/** Simulate a user selecting files via the hidden <input>. */
async function selectFiles(files: File[]) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  await act(async () => {
    fireEvent.change(input);
  });
}

/** Simulate dropping files onto a drop zone. */
async function dropFiles(element: HTMLElement, files: File[]) {
  await act(async () => {
    fireEvent.drop(element, { dataTransfer: { files } });
  });
}

/** Simulate a dragover event (e.g., to change the label). */
async function dragOver(element: HTMLElement) {
  await act(async () => {
    fireEvent.dragOver(element);
  });
}

/** Simulate a dragleave event. */
async function dragLeave(element: HTMLElement) {
  await act(async () => {
    fireEvent.dragLeave(element);
  });
}

// ─── formatBytes ─────────────────────────────────────────────────────────────

describe('formatBytes', () => {
  it('formats bytes', () => expect(formatBytes(512)).toBe('512 B'));
  it('formats kilobytes', () => expect(formatBytes(1_536)).toBe('1.5 KB'));
  it('formats megabytes', () => expect(formatBytes(10_485_760)).toBe('10.0 MB'));
});

// ─── FileUpload ───────────────────────────────────────────────────────────────

describe('FileUpload', () => {
  // ── Rendering ────────────────────────────────────────────────────────────

  describe('Rendering', () => {
    it('renders the drop-zone button', () => {
      render(<FileUpload />);
      expect(
        screen.getByRole('button', { name: /file upload area/i }),
      ).toBeInTheDocument();
    });

    it('renders a hidden file input', () => {
      render(<FileUpload />);
      const input = document.querySelector('input[type="file"]');
      expect(input).toBeInTheDocument();
      expect(input).toHaveClass('sr-only');
      expect(input).toHaveAttribute('aria-hidden', 'true');
    });

    it('shows constraint text with custom props', () => {
      render(
        <FileUpload
          accept={['image/png', 'application/pdf']}
          maxSizeBytes={5 * 1024 * 1024}
          maxFiles={3}
        />,
      );
      expect(screen.getByText(/image\/png/)).toBeInTheDocument();
      expect(screen.getByText(/5\.0 MB/)).toBeInTheDocument();
      expect(screen.getByText(/Max files: 3/)).toBeInTheDocument();
    });

    it('shows "Maximum file count reached" text when full', async () => {
      const onUpload = jest.fn().mockResolvedValue(undefined);
      render(<FileUpload maxFiles={1} onUpload={onUpload} />);
      await selectFiles([makeFile('a.png', 100, 'image/png')]);
      await waitFor(() =>
        expect(screen.getByText(/maximum file count reached/i)).toBeInTheDocument(),
      );
    });

    it('applies a custom className', () => {
      const { container } = render(<FileUpload className="custom-class" />);
      expect(container.firstChild).toHaveClass('custom-class');
    });
  });

  // ── Validation ───────────────────────────────────────────────────────────

  describe('Validation', () => {
    it('shows an alert when a file exceeds the size limit', async () => {
      render(<FileUpload maxSizeBytes={500} />);
      await selectFiles([makeFile('big.png', 600, 'image/png')]);
      const alert = screen.getByRole('alert');
      expect(alert).toBeInTheDocument();
      expect(alert).toHaveTextContent(/exceeding/i);
    });

    it('shows an alert for an unsupported file type', async () => {
      render(<FileUpload accept={['image/png']} />);
      await selectFiles([makeFile('doc.pdf', 100, 'application/pdf')]);
      expect(screen.getByRole('alert')).toHaveTextContent(/unsupported file type/i);
    });

    it('shows an alert when the max file count would be exceeded', async () => {
      render(<FileUpload maxFiles={1} />);
      await selectFiles([
        makeFile('a.png', 100, 'image/png'),
        makeFile('b.png', 100, 'image/png'),
      ]);
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('shows an alert when max files is already reached', async () => {
      const onUpload = jest.fn().mockResolvedValue(undefined);
      render(<FileUpload maxFiles={1} onUpload={onUpload} />);

      // Fill the slot.
      await selectFiles([makeFile('a.png', 100, 'image/png')]);
      await waitFor(() => screen.getByText('Done'));

      // Drop another file — the zone is full so validation fires.
      const dropZone = screen.getByRole('button', { name: /file upload area/i });
      const file = makeFile('b.png', 100, 'image/png');
      await dropFiles(dropZone, [file]);

      expect(screen.getByRole('alert')).toHaveTextContent(/maximum/i);
    });

    it('dismisses the error alert when the × button is clicked', async () => {
      const user = userEvent.setup();
      render(<FileUpload maxSizeBytes={10} />);
      await selectFiles([makeFile('big.png', 100, 'image/png')]);
      expect(screen.getByRole('alert')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /dismiss errors/i }));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('does not show an alert for a valid file', async () => {
      const onUpload = jest.fn().mockResolvedValue(undefined);
      render(<FileUpload onUpload={onUpload} />);
      await selectFiles([makeFile('photo.png', 100, 'image/png')]);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('accepts wildcard MIME types (image/*)', async () => {
      const onUpload = jest.fn().mockResolvedValue(undefined);
      render(<FileUpload accept={['image/*']} onUpload={onUpload} />);
      await selectFiles([makeFile('photo.jpg', 100, 'image/jpeg')]);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByText('photo.jpg')).toBeInTheDocument();
    });

    it('rejects files that do not match a wildcard MIME type', async () => {
      render(<FileUpload accept={['image/*']} />);
      await selectFiles([makeFile('doc.pdf', 100, 'application/pdf')]);
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('does not add invalid files to the list', async () => {
      render(<FileUpload maxSizeBytes={10} />);
      await selectFiles([makeFile('big.png', 100, 'image/png')]);
      expect(screen.queryByText('big.png')).not.toBeInTheDocument();
    });
  });

  // ── File list ────────────────────────────────────────────────────────────

  describe('File list', () => {
    it('adds valid files to the list immediately', async () => {
      const onUpload = jest.fn().mockResolvedValue(undefined);
      render(<FileUpload onUpload={onUpload} />);
      await selectFiles([makeFile('photo.png', 100, 'image/png')]);
      expect(screen.getByText('photo.png')).toBeInTheDocument();
    });

    it('shows a "Done" badge after a successful upload', async () => {
      const onUpload = jest.fn().mockResolvedValue(undefined);
      render(<FileUpload onUpload={onUpload} />);
      await selectFiles([makeFile('photo.png', 100, 'image/png')]);
      await waitFor(() => expect(screen.getByText('Done')).toBeInTheDocument());
    });

    it('shows a "Failed" badge after a failed upload', async () => {
      const onUpload = jest.fn().mockRejectedValue(new Error('Network error'));
      render(<FileUpload onUpload={onUpload} />);
      await selectFiles([makeFile('photo.png', 100, 'image/png')]);
      await waitFor(() => expect(screen.getByText('Failed')).toBeInTheDocument());
    });

    it('displays the error message from a failed upload', async () => {
      const onUpload = jest.fn().mockRejectedValue(new Error('Network error'));
      render(<FileUpload onUpload={onUpload} />);
      await selectFiles([makeFile('photo.png', 100, 'image/png')]);
      await waitFor(() => expect(screen.getByText('Network error')).toBeInTheDocument());
    });

    it('shows a fallback error message when the rejection is not an Error', async () => {
      const onUpload = jest.fn().mockRejectedValue('string error');
      render(<FileUpload onUpload={onUpload} />);
      await selectFiles([makeFile('photo.png', 100, 'image/png')]);
      await waitFor(() =>
        expect(screen.getByText(/please try again/i)).toBeInTheDocument(),
      );
    });

    it('removes a file when the remove button is clicked', async () => {
      const user = userEvent.setup();
      const onUpload = jest.fn().mockResolvedValue(undefined);
      render(<FileUpload onUpload={onUpload} />);
      await selectFiles([makeFile('photo.png', 100, 'image/png')]);
      await waitFor(() => screen.getByLabelText(/Remove photo\.png/i));
      await user.click(screen.getByLabelText(/Remove photo\.png/i));
      await waitFor(() => {
        expect(screen.queryByText('photo.png')).not.toBeInTheDocument();
      });
    });

    it('shows a retry button after a failed upload', async () => {
      const onUpload = jest.fn().mockRejectedValue(new Error('Timeout'));
      render(<FileUpload onUpload={onUpload} />);
      await selectFiles([makeFile('photo.png', 100, 'image/png')]);
      await waitFor(() => screen.getByLabelText(/Retry upload for photo\.png/i));
      expect(screen.getByLabelText(/Retry upload/i)).toBeInTheDocument();
    });

    it('retries the upload when the retry button is clicked', async () => {
      const user = userEvent.setup();
      const onUpload = jest
        .fn()
        .mockRejectedValueOnce(new Error('Timeout'))
        .mockResolvedValueOnce(undefined);
      render(<FileUpload onUpload={onUpload} />);
      await selectFiles([makeFile('photo.png', 100, 'image/png')]);
      await waitFor(() => screen.getByLabelText(/Retry upload/i));
      await user.click(screen.getByLabelText(/Retry upload/i));
      await waitFor(() => expect(screen.getByText('Done')).toBeInTheDocument());
      expect(onUpload).toHaveBeenCalledTimes(2);
    });

    it('disables the remove button while uploading', async () => {
      const onUpload = jest.fn(() => new Promise<void>(() => {}));
      render(<FileUpload onUpload={onUpload} />);
      await selectFiles([makeFile('photo.png', 100, 'image/png')]);
      const removeBtn = screen.getByLabelText(/Remove photo\.png/i);
      expect(removeBtn).toBeDisabled();
    });

    it('calls onFilesChange when files are added', async () => {
      const onFilesChange = jest.fn();
      const onUpload = jest.fn().mockResolvedValue(undefined);
      render(<FileUpload onUpload={onUpload} onFilesChange={onFilesChange} />);
      await selectFiles([makeFile('photo.png', 100, 'image/png')]);
      expect(onFilesChange).toHaveBeenCalled();
    });

    it('calls onFilesChange when a file is removed', async () => {
      const user = userEvent.setup();
      const onFilesChange = jest.fn();
      const onUpload = jest.fn().mockResolvedValue(undefined);
      render(<FileUpload onUpload={onUpload} onFilesChange={onFilesChange} />);
      await selectFiles([makeFile('photo.png', 100, 'image/png')]);
      await waitFor(() => screen.getByLabelText(/Remove photo\.png/i));
      onFilesChange.mockClear();
      await user.click(screen.getByLabelText(/Remove photo\.png/i));
      expect(onFilesChange).toHaveBeenCalledWith([]);
    });
  });

  // ── Drag and drop ────────────────────────────────────────────────────────

  describe('Drag and drop', () => {
    it('changes the label to "Drop files here" on dragover', async () => {
      render(<FileUpload />);
      const dropZone = screen.getByRole('button', { name: /file upload area/i });
      await dragOver(dropZone);
      expect(screen.getByText(/Drop files here/i)).toBeInTheDocument();
    });

    it('restores the default label on dragleave', async () => {
      render(<FileUpload />);
      const dropZone = screen.getByRole('button', { name: /file upload area/i });
      await dragOver(dropZone);
      expect(screen.getByText(/Drop files here/i)).toBeInTheDocument();
      await dragLeave(dropZone);
      expect(screen.getByText(/Click or drag files to upload/i)).toBeInTheDocument();
    });

    it('accepts files dropped onto the drop zone', async () => {
      const onUpload = jest.fn().mockResolvedValue(undefined);
      render(<FileUpload onUpload={onUpload} />);
      const dropZone = screen.getByRole('button', { name: /file upload area/i });
      const file = makeFile('dropped.png', 100, 'image/png');
      await dropFiles(dropZone, [file]);
      expect(screen.getByText('dropped.png')).toBeInTheDocument();
    });

    it('validates dropped files', async () => {
      render(<FileUpload maxSizeBytes={10} />);
      const dropZone = screen.getByRole('button', { name: /file upload area/i });
      const file = makeFile('big.png', 100, 'image/png');
      await dropFiles(dropZone, [file]);
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  // ── Accessibility ────────────────────────────────────────────────────────

  describe('Accessibility', () => {
    it('opens the file dialog on Enter keydown', async () => {
      const user = userEvent.setup();
      render(<FileUpload />);
      const clickSpy = jest.spyOn(HTMLInputElement.prototype, 'click');
      const button = screen.getByRole('button', { name: /file upload area/i });
      await user.click(button);
      await user.keyboard('{Enter}');
      expect(clickSpy).toHaveBeenCalled();
      clickSpy.mockRestore();
    });

    it('opens the file dialog on Space keydown', async () => {
      const user = userEvent.setup();
      render(<FileUpload />);
      const clickSpy = jest.spyOn(HTMLInputElement.prototype, 'click');
      const button = screen.getByRole('button', { name: /file upload area/i });
      await user.click(button);
      await user.keyboard(' ');
      expect(clickSpy).toHaveBeenCalled();
      clickSpy.mockRestore();
    });

    it('renders the progress bar with correct ARIA attributes while uploading', async () => {
      let resolveUpload!: () => void;
      const onUpload = jest.fn(
        () => new Promise<void>((res) => { resolveUpload = res; }),
      );
      render(<FileUpload onUpload={onUpload} />);
      await selectFiles([makeFile('photo.png', 100, 'image/png')]);
      await waitFor(() => screen.getByRole('progressbar'));
      const bar = screen.getByRole('progressbar');
      expect(bar).toHaveAttribute('aria-valuemin', '0');
      expect(bar).toHaveAttribute('aria-valuemax', '100');
      expect(bar).toHaveAttribute('aria-label', expect.stringContaining('photo.png'));
      await act(async () => { resolveUpload(); });
    });

    it('removes the progress bar after upload succeeds', async () => {
      const onUpload = jest.fn().mockResolvedValue(undefined);
      render(<FileUpload onUpload={onUpload} />);
      await selectFiles([makeFile('photo.png', 100, 'image/png')]);
      await waitFor(() => expect(screen.getByText('Done')).toBeInTheDocument());
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });

    it('provides an accessible label for remove buttons', async () => {
      const onUpload = jest.fn().mockResolvedValue(undefined);
      render(<FileUpload onUpload={onUpload} />);
      await selectFiles([makeFile('report.pdf', 100, 'application/pdf')]);
      await waitFor(() =>
        expect(screen.getByLabelText('Remove report.pdf')).toBeInTheDocument(),
      );
    });

    it('the file list has an accessible label', async () => {
      const onUpload = jest.fn().mockResolvedValue(undefined);
      render(<FileUpload onUpload={onUpload} />);
      await selectFiles([makeFile('photo.png', 100, 'image/png')]);
      expect(screen.getByRole('list', { name: /uploaded files/i })).toBeInTheDocument();
    });
  });

  // ── Progress callback ────────────────────────────────────────────────────

  describe('Progress callback', () => {
    it('calls onUpload with a working progress callback', async () => {
      let capturedCallback!: (pct: number) => void;
      let resolveUpload!: () => void;
      const onUpload = jest.fn((_file: File, onProgress: (pct: number) => void) => {
        capturedCallback = onProgress;
        return new Promise<void>((res) => { resolveUpload = res; });
      });
      render(<FileUpload onUpload={onUpload} />);
      await selectFiles([makeFile('photo.png', 100, 'image/png')]);
      await waitFor(() => screen.getByRole('progressbar'));
      act(() => capturedCallback(50));
      const bar = screen.getByRole('progressbar');
      expect(bar).toHaveAttribute('aria-valuenow', '50');
      await act(async () => { resolveUpload(); });
    });
  });
});