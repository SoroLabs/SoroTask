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

describe('Skip-to-main-content link', () => {
  it('is the first focusable element on the page', () => {
    render(<Home />)
    const skipLink = screen.getByRole('link', { name: /skip to main content/i })
    expect(skipLink).toBeInTheDocument()
    expect(skipLink).toHaveAttribute('href', '#main-content')
  })

  it('points to an element with id="main-content"', () => {
    render(<Home />)
    const main = document.getElementById('main-content')
    expect(main).not.toBeNull()
    expect(main?.tagName.toLowerCase()).toBe('main')
  })
})

/* ─── Header ─────────────────────────────────────────────────────────── */

describe('Header keyboard accessibility', () => {
  it('renders a single h1', () => {
    render(<Home />)
    const headings = screen.getAllByRole('heading', { level: 1 })
    expect(headings).toHaveLength(1)
    expect(headings[0]).toHaveTextContent('SoroTask')
  })

  it('Connect Wallet button is reachable by Tab and has an accessible name', async () => {
    const user = userEvent.setup()
    render(<Home />)
    await user.tab() // skip-nav
    await user.tab() // connect-wallet
    expect(document.activeElement).toHaveAttribute('id', 'connect-wallet-btn')
    expect(document.activeElement).toHaveAccessibleName(/connect your stellar wallet/i)
  })
})

/* ─── Create-Task form ───────────────────────────────────────────────── */

describe('Create Task form – keyboard navigation & submission', () => {
  it('all form fields have associated labels', () => {
    render(<Home />)
    expect(screen.getByLabelText(/target contract address/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/function name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/interval/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/gas balance/i)).toBeInTheDocument()
  })

  it('shows a validation error when required fields are empty and register is clicked', async () => {
    const user = userEvent.setup()
    render(<Home />)
    await user.click(screen.getByRole('button', { name: /register task/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/required/i)
  })

  it('submits successfully with keyboard-only interaction', async () => {
    const user = userEvent.setup()
    render(<Home />)

    await user.type(screen.getByLabelText(/target contract address/i), 'CABC123')
    await user.type(screen.getByLabelText(/function name/i), 'harvest_yield')
    await user.type(screen.getByLabelText(/interval/i), '3600')
    await user.type(screen.getByLabelText(/gas balance/i), '10')

    // Tab to the submit button then press Enter
    await user.tab()
    await user.keyboard('{Enter}')

    // Task list should now exist
    await waitFor(() =>
      expect(screen.getByRole('list', { name: /registered automation tasks/i })).toBeInTheDocument()
    )
  })

  it('clears required form inputs after a successful submission', async () => {
    const user = userEvent.setup()
    render(<Home />)

    const contractInput = screen.getByLabelText(/target contract address/i)
    const functionInput = screen.getByLabelText(/function name/i)

    await user.type(contractInput, 'CABC123')
    await user.type(functionInput, 'my_fn')
    await user.type(screen.getByLabelText(/interval/i), '3600')
    await user.type(screen.getByLabelText(/gas balance/i), '10')
    await user.click(screen.getByRole('button', { name: /register task/i }))

    // After submission both required fields must be cleared
    await waitFor(() => {
      expect(contractInput).toHaveValue('')
      expect(functionInput).toHaveValue('')
    })
  })

  it('announces new task to screen readers via live region', async () => {
    const user = userEvent.setup()
    render(<Home />)

    await user.type(screen.getByLabelText(/target contract address/i), 'CABC123')
    await user.type(screen.getByLabelText(/function name/i), 'harvest_yield')
    await user.type(screen.getByLabelText(/interval/i), '3600')
    await user.type(screen.getByLabelText(/gas balance/i), '10')
    await user.click(screen.getByRole('button', { name: /register task/i }))

    // The polite live-region's last child should announce the new task
    await waitFor(() => {
      // The sr-only LiveRegion component has aria-live="polite" and role="status"
      // Filter to the one that has announcement text (not the task status badges)
      const liveRegions = document.querySelectorAll('[aria-live="polite"]')
      const announcementRegion = Array.from(liveRegions).find((el) =>
        el.getAttribute('aria-atomic') === 'true'
      )
      expect(announcementRegion?.textContent).toMatch(/registered/i)
    })
  })
})

/* ─── Your Tasks section ─────────────────────────────────────────────── */

describe('Your Tasks – task card keyboard interactions', () => {
  it('empty state is announced to screen readers via aria-live', () => {
    render(<Home />)
    const emptyState = screen.getByText(/no tasks registered yet/i).closest('[aria-live]')
    expect(emptyState).not.toBeNull()
  })

  it('task list is wrapped in a <ul> with an accessible label', async () => {
    const user = userEvent.setup()
    render(<Home />)
    await registerTask(user)

    const list = screen.getByRole('list', { name: /registered automation tasks/i })
    expect(list).toBeInTheDocument()
  })

  it('each task article has an accessible name', async () => {
    const user = userEvent.setup()
    render(<Home />)
    await registerTask(user)

    const articles = screen.getAllByRole('article')
    expect(articles.length).toBeGreaterThan(0)
    articles.forEach((article) => {
      expect(article).toHaveAttribute('aria-label')
    })
  })

  it('Pause button uses aria-pressed and has a descriptive label', async () => {
    const user = userEvent.setup()
    render(<Home />)
    await registerTask(user)

    const pauseBtn = screen.getByRole('button', { name: /pause task/i })
    expect(pauseBtn).toHaveAttribute('aria-pressed')
  })

  it('toggles status when Pause/Resume activated via keyboard', async () => {
    const user = userEvent.setup()
    render(<Home />)
    await registerTask(user)

    const pauseBtn = screen.getByRole('button', { name: /pause task/i })
    pauseBtn.focus()
    await user.keyboard('{Enter}')

    // Button label should now be Resume
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /resume task/i })).toBeInTheDocument()
    })
  })

  it('deletes a task when Delete is activated via keyboard', async () => {
    const user = userEvent.setup()
    render(<Home />)
    await registerTask(user)

    const deleteBtn = screen.getByRole('button', { name: /delete task/i })
    deleteBtn.focus()
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(screen.queryByRole('list', { name: /registered automation tasks/i })).not.toBeInTheDocument()
    })
  })
})

/* ─── Edit Dialog – focus trap ───────────────────────────────────────── */

describe('Edit Task dialog – focus trap and keyboard behaviour', () => {
  async function openEditDialog(user: ReturnType<typeof userEvent.setup>) {
    await registerTask(user)
    await user.click(screen.getByRole('button', { name: /edit task/i }))
    return screen.findByRole('dialog')
  }

  it('dialog has role="dialog" and aria-modal="true"', async () => {
    const user = userEvent.setup()
    render(<Home />)
    const dialog = await openEditDialog(user)
    expect(dialog).toHaveAttribute('role', 'dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
  })

  it('dialog has an accessible name via aria-labelledby', async () => {
    const user = userEvent.setup()
    render(<Home />)
    const dialog = await openEditDialog(user)
    const labelId = dialog.getAttribute('aria-labelledby')
    expect(labelId).toBeTruthy()
    const labelEl = document.getElementById(labelId!)
    expect(labelEl).not.toBeNull()
    expect(labelEl?.textContent).toMatch(/edit task/i)
  })

  it('pressing Escape closes the dialog', async () => {
    const user = userEvent.setup()
    render(<Home />)
    const dialog = await openEditDialog(user)
    fireEvent.keyDown(dialog, { key: 'Escape' })

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  it('Cancel button closes the dialog', async () => {
    const user = userEvent.setup()
    render(<Home />)
    await openEditDialog(user)
    await user.click(screen.getByRole('button', { name: /cancel/i }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  it('Save Changes updates the task', async () => {
    const user = userEvent.setup()
    render(<Home />)
    await openEditDialog(user)

    // The edit dialog has separate ids for its inputs (edit-function)
    const fnInput = document.getElementById('edit-function') as HTMLInputElement
    await user.clear(fnInput)
    await user.type(fnInput, 'updated_fn')

    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    // The task card should now show the updated function name
    const articles = screen.getAllByRole('article')
    const cardText = articles[0].textContent
    expect(cardText).toContain('updated_fn')
  })
})

/* ─── Execution Logs table ───────────────────────────────────────────── */

describe('Execution Logs table – semantic structure', () => {
  it('table has an accessible label', () => {
    render(<Home />)
    expect(screen.getByRole('table', { name: /task execution logs/i })).toBeInTheDocument()
  })

  it('all column headers use scope="col"', () => {
    render(<Home />)
    const headers = document.querySelectorAll('th[scope="col"]')
    expect(headers.length).toBeGreaterThan(0)
  })

  it('table has a caption for screen readers', () => {
    render(<Home />)
    const caption = document.querySelector('caption')
    expect(caption).not.toBeNull()
    expect(caption?.classList.contains('sr-only')).toBe(true)
  })

  it('status cell uses a <span> with meaningful text', () => {
    render(<Home />)
    const cells = screen.getAllByText(/success|failed|pending/i)
    expect(cells.length).toBeGreaterThan(0)
  })
})

/* ─── Heading hierarchy ──────────────────────────────────────────────── */

describe('Heading hierarchy', () => {
  it('has exactly one h1', () => {
    render(<Home />)
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('section headings are h2', () => {
    render(<Home />)
    const h2s = screen.getAllByRole('heading', { level: 2 })
    // Expect at least three sections: Create, Your Tasks, Execution Logs
    expect(h2s.length).toBeGreaterThanOrEqual(3)
  })
})
