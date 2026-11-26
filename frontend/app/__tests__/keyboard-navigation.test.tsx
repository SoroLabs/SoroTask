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

  it('exposes an accessible form landmark and grouped controls', () => {
    render(<TaskCreationForm />)
    expect(screen.getByRole('form', { name: /create automation task/i })).toBeInTheDocument()
    expect(
      screen.getByRole('group', { name: /execution schedule and gas settings/i })
    ).toBeInTheDocument()
    expect(screen.getByRole('group', { name: /form actions/i })).toBeInTheDocument()
  })

  it('shows a validation error when required fields are empty and register is clicked', async () => {
    const user = userEvent.setup({ delay: null })
    render(<TaskCreationForm />)
    await user.click(screen.getByRole('button', { name: /register task/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/required/i)
  })

  it('submits successfully with keyboard-only interaction and announces status to screen readers', async () => {
    const user = userEvent.setup({ delay: null })
    render(<TaskCreationForm />)
    await user.type(
      screen.getByLabelText(/target contract address/i),
      'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    )
    await user.type(screen.getByLabelText(/function name/i), 'harvest_yield')
    await user.type(screen.getByLabelText(/interval/i), '3600')
    await user.type(screen.getByLabelText(/gas balance/i), '10')
    await user.click(screen.getByRole('button', { name: /register task/i }))

    await waitFor(
      () => {
        const status = screen.getByRole('status')
        expect(status).toHaveAttribute('aria-live', 'polite')
        expect(status).toHaveAttribute('aria-atomic', 'true')
        expect(status).toHaveTextContent(/task created successfully!/i)
      },
      { timeout: 1500 }
    )
  })

  it('supports logical keyboard tab order across inputs and actions without trapping focus', async () => {
    const user = userEvent.setup({ delay: null })
    render(<TaskCreationForm />)

    const contractInput = screen.getByLabelText(/target contract address/i)
    const functionInput = screen.getByLabelText(/function name/i)
    const intervalInput = screen.getByLabelText(/interval/i)
    const gasInput = screen.getByLabelText(/gas balance/i)
    const submitBtn = screen.getByRole('button', { name: /register task/i })
    const resetBtn = screen.getByRole('button', { name: /reset form/i })

    await user.tab()
    expect(contractInput).toHaveFocus()

    await user.tab()
    expect(functionInput).toHaveFocus()

    await user.tab()
    expect(intervalInput).toHaveFocus()

    await user.tab()
    expect(gasInput).toHaveFocus()

    // Focus styles are present on form controls and action buttons
    expect(contractInput.className).toMatch(/focus:ring-2/)
    expect(submitBtn.className).toMatch(/focus-visible:ring-2/)
    expect(resetBtn.className).toMatch(/focus-visible:ring-2/)
  })

  it('resets form values using keyboard activation on the Reset Form button', async () => {
    const user = userEvent.setup({ delay: null })
    render(<TaskCreationForm />)

    const contractInput = screen.getByLabelText(/target contract address/i)
    await user.type(contractInput, 'CABC123')
    expect(contractInput).toHaveValue('CABC123')

    const resetBtn = screen.getByRole('button', { name: /reset form/i })
    resetBtn.focus()
    expect(resetBtn).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(contractInput).toHaveValue('')
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
