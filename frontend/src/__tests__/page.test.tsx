import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import Home from '../../app/page'
import * as taskClient from '../lib/task-client'

type Mocked<T> = {
  [P in keyof T]: jest.Mock
}

jest.mock('../lib/task-client', () => ({
  fetchTasks: jest.fn(),
  createTask: jest.fn(),
  updateTask: jest.fn(),
  deleteTask: jest.fn(),
  moveTask: jest.fn(),
}))

describe('Home optimistic task UI', () => {
  const api = taskClient as unknown as Mocked<typeof taskClient>

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('shows optimistic create state and replaces it after success', async () => {
    api.fetchTasks.mockResolvedValue([])
    api.createTask.mockResolvedValue({
      id: 'task-created',
      target: 'C123',
      func: 'harvest_yield',
      interval: 3600,
      balance: 10,
      status: 'active',
    })

    render(<Home />)

    await waitFor(() => expect(api.fetchTasks).toHaveBeenCalled())

    fireEvent.change(screen.getByLabelText(/Target Contract Address/i), {
      target: { value: 'C123' },
    })
    fireEvent.change(screen.getByLabelText(/Function Name/i), {
      target: { value: 'harvest_yield' },
    })
    fireEvent.change(screen.getByLabelText(/Interval \(seconds\)/i), {
      target: { value: '3600' },
    })
    fireEvent.change(screen.getByLabelText(/Gas Balance \(XLM\)/i), {
      target: { value: '10' },
    })

    fireEvent.click(screen.getByRole('button', { name: /Register Task/i }))

    await waitFor(() => expect(api.createTask).toHaveBeenCalled())

    expect(await screen.findByText('harvest_yield')).toBeInTheDocument()
    expect(screen.queryByText(/Task registration failed/i)).not.toBeInTheDocument()
  })

  it('rolls back optimistic create on failure', async () => {
    api.fetchTasks.mockResolvedValue([])
    api.createTask.mockRejectedValue(new Error('Network failure'))

    render(<Home />)

    await waitFor(() => expect(api.fetchTasks).toHaveBeenCalled())

    fireEvent.change(screen.getByLabelText(/Target Contract Address/i), {
      target: { value: 'C123' },
    })
    fireEvent.change(screen.getByLabelText(/Function Name/i), {
      target: { value: 'harvest_yield' },
    })

    fireEvent.click(screen.getByRole('button', { name: /Register Task/i }))

    expect(await screen.findByText(/Task registration failed/i)).toBeInTheDocument()
    expect(screen.queryByText('harvest_yield')).not.toBeInTheDocument()
  })

  it('rolls back delete on failure and surfaces task error state', async () => {
    api.fetchTasks.mockResolvedValue([
      {
        id: 'task-500',
        target: 'C500',
        func: 'rebalance',
        interval: 7200,
        balance: 8,
        status: 'active',
      },
    ])
    api.deleteTask.mockRejectedValue(new Error('Delete failed'))

    render(<Home />)

    await waitFor(() => expect(api.fetchTasks).toHaveBeenCalled())
    await screen.findByText('rebalance')

    fireEvent.click(screen.getByRole('button', { name: /Delete/i }))

    expect(await screen.findByText(/Unable to remove task/i)).toBeInTheDocument()
    expect(screen.getByText('rebalance')).toBeInTheDocument()
  })
})
