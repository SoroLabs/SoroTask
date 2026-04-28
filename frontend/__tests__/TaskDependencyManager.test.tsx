import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import TaskDependencyManager from '../components/TaskDependencyManager';
import { Task } from '../components/TaskDependencyManager';

const mockTask: Task = {
  id: 2,
  creator: 'GABC...XYZ',
  target: 'CDEF...456',
  function: 'compound',
  interval: 7200,
  lastRun: 0,
  gasBalance: 500,
  isActive: true,
  blockedBy: [1],
};

const mockAllTasks: Task[] = [
  {
    id: 1,
    creator: 'GABC...XYZ',
    target: 'CDEF...123',
    function: 'harvest_yield',
    interval: 3600,
    lastRun: 1704067200,
    gasBalance: 1000,
    isActive: true,
    blockedBy: [],
  },
  mockTask,
  {
    id: 3,
    creator: 'GABC...XYZ',
    target: 'CDEF...789',
    function: 'rebalance',
    interval: 86400,
    lastRun: 0,
    gasBalance: 2000,
    isActive: true,
    blockedBy: [],
  },
];

describe('TaskDependencyManager', () => {
  const mockOnAddDependency = jest.fn();
  const mockOnRemoveDependency = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders dependencies list', () => {
    render(
      <TaskDependencyManager
        task={mockTask}
        allTasks={mockAllTasks}
        onAddDependency={mockOnAddDependency}
        onRemoveDependency={mockOnRemoveDependency}
      />
    );

    expect(screen.getByText('Dependencies')).toBeInTheDocument();
    expect(screen.getByText('Task #1')).toBeInTheDocument();
  });

  it('shows "No dependencies" when blockedBy is empty', () => {
    const taskWithNoDeps = { ...mockTask, blockedBy: [] };
    render(
      <TaskDependencyManager
        task={taskWithNoDeps}
        allTasks={mockAllTasks}
        onAddDependency={mockOnAddDependency}
        onRemoveDependency={mockOnRemoveDependency}
      />
    );

    expect(screen.getByText('No dependencies')).toBeInTheDocument();
  });

  it('displays blocking status for incomplete dependencies', () => {
    render(
      <TaskDependencyManager
        task={mockTask}
        allTasks={mockAllTasks}
        onAddDependency={mockOnAddDependency}
        onRemoveDependency={mockOnRemoveDependency}
      />
    );

    // Task 1 has lastRun > 0, so it should show "Completed"
    expect(screen.getByText('Completed')).toBeInTheDocument();
  });

  it('allows adding a new dependency', async () => {
    mockOnAddDependency.mockResolvedValue(undefined);

    render(
      <TaskDependencyManager
        task={mockTask}
        allTasks={mockAllTasks}
        onAddDependency={mockOnAddDependency}
        onRemoveDependency={mockOnRemoveDependency}
      />
    );

    const select = screen.getByRole('combobox');
    const addButton = screen.getByText('Add');

    fireEvent.change(select, { target: { value: '3' } });
    fireEvent.click(addButton);

    await waitFor(() => {
      expect(mockOnAddDependency).toHaveBeenCalledWith(2, 3);
    });
  });

  it('allows removing a dependency', async () => {
    mockOnRemoveDependency.mockResolvedValue(undefined);

    render(
      <TaskDependencyManager
        task={mockTask}
        allTasks={mockAllTasks}
        onAddDependency={mockOnAddDependency}
        onRemoveDependency={mockOnRemoveDependency}
      />
    );

    const removeButton = screen.getByText('Remove');
    fireEvent.click(removeButton);

    await waitFor(() => {
      expect(mockOnRemoveDependency).toHaveBeenCalledWith(2, 1);
    });
  });

  it('displays error message on add failure', async () => {
    mockOnAddDependency.mockRejectedValue(new Error('Failed to add dependency'));

    render(
      <TaskDependencyManager
        task={mockTask}
        allTasks={mockAllTasks}
        onAddDependency={mockOnAddDependency}
        onRemoveDependency={mockOnRemoveDependency}
      />
    );

    const select = screen.getByRole('combobox');
    const addButton = screen.getByText('Add');

    fireEvent.change(select, { target: { value: '3' } });
    fireEvent.click(addButton);

    await waitFor(() => {
      expect(screen.getByText('Failed to add dependency')).toBeInTheDocument();
    });
  });

  it('filters out current task and existing dependencies from available tasks', () => {
    render(
      <TaskDependencyManager
        task={mockTask}
        allTasks={mockAllTasks}
        onAddDependency={mockOnAddDependency}
        onRemoveDependency={mockOnRemoveDependency}
      />
    );

    const select = screen.getByRole('combobox');
    const options = Array.from(select.querySelectorAll('option')).map(
      (opt) => opt.textContent
    );

    // Should not include task 2 (self) or task 1 (already a dependency)
    expect(options).not.toContain('Task #2');
    expect(options).not.toContain('Task #1');
    expect(options.some((opt) => opt?.includes('Task #3'))).toBe(true);
  });

  it('disables add button when no task is selected', () => {
    render(
      <TaskDependencyManager
        task={mockTask}
        allTasks={mockAllTasks}
        onAddDependency={mockOnAddDependency}
        onRemoveDependency={mockOnRemoveDependency}
      />
    );

    const addButton = screen.getByText('Add');
    expect(addButton).toBeDisabled();
  });
});
