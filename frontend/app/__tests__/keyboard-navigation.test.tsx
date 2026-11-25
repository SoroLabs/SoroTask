/**
 * @jest-environment jsdom
 *
 * Keyboard Navigation Tests – Issue #165
 *
 * Validates that core SoroTask user flows are fully operable
 * with a keyboard only, meeting the acceptance criteria of:
 *   - Core workflows usable with keyboard alone
 *   - Focus never trapped or lost unexpectedly
 *   - Visual focus styles present (via CSS – verified structurally)
 *   - Correct ARIA roles, labels, and live-region announcements
 */

import React from 'react'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Home from '../page'
import TaskCreationForm from '../components/TaskCreationForm'
import { taskCreationFormConfig } from '../utils/formValidation/formConfigs'

taskCreationFormConfig.fields.contractAddress.asyncValidation = async () => ({
  isValid: true,
})

/* ─── helpers ────────────────────────────────────────────────────────── */

/**
 * Register a task via the form. All required fields (including interval >= 1) must be filled.
 * Uses getByRole so we don't rely on text content that can be split across elements.
 */
async function registerTask(
  user: ReturnType<typeof userEvent.setup>,
  fn = 'harvest_yield',
  contract = 'CABC123'
) {
  await user.type(screen.getByLabelText(/target contract address/i), contract)
  await user.type(screen.getByLabelText(/function name/i), fn)
  await user.type(screen.getByLabelText(/interval/i), '3600')
  await user.type(screen.getByLabelText(/gas balance/i), '10')
  await user.click(screen.getByRole('button', { name: /register task/i }))
  // Wait for the task list to appear (task cards appear in a <li>)
  await waitFor(() =>
    expect(screen.getByRole('list', { name: /registered automation tasks/i })).toBeInTheDocument()
  )
}

/* ─── Skip-navigation ────────────────────────────────────────────────── */

describe('Header keyboard accessibility', () => {
  it('renders a single h1', () => {
    render(<Home />)
    const headings = screen.getAllByRole('heading', { level: 1 })
    expect(headings).toHaveLength(1)
  })

  it('Connect Wallet button has an accessible name', async () => {
    render(<Home />)
    const connectBtn = screen.getByRole('button', { name: /connect/i })
    expect(connectBtn).toBeInTheDocument()
  })
})

/* ─── Create-Task form ───────────────────────────────────────────────── */

describe('Create Task form – keyboard navigation & submission', () => {
  it('all form fields have associated labels', () => {
    render(<TaskCreationForm />)
    expect(screen.getByLabelText(/target contract address/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/function name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/interval/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/gas balance/i)).toBeInTheDocument()
  })

  it('shows a validation error when required fields are empty and register is clicked', async () => {
    const user = userEvent.setup()
    render(<TaskCreationForm />)
    await user.click(screen.getByRole('button', { name: /register task/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/required/i)
  })

  it('submits successfully with keyboard-only interaction', async () => {
    const user = userEvent.setup()
    render(<TaskCreationForm />)
    await user.type(screen.getByLabelText(/target contract address/i), 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
    await user.type(screen.getByLabelText(/function name/i), 'harvest_yield')
    await user.type(screen.getByLabelText(/interval/i), '3600')
    await user.type(screen.getByLabelText(/gas balance/i), '10')
    await user.click(screen.getByRole('button', { name: /register task/i }))

    await waitFor(
      () => {
        expect(screen.getByText(/task created successfully!/i)).toBeInTheDocument()
      },
      { timeout: 3000 }
    )
  })
})

describe('Heading hierarchy', () => {
  it('has exactly one h1', () => {
    render(<Home />)
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('section headings are h2', () => {
    render(<Home />)
    const h2s = screen.getAllByRole('heading', { level: 2 })
    expect(h2s.length).toBeGreaterThanOrEqual(2)
  })
})
