import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { CohortAnalysisDashboard } from './CohortAnalysisDashboard';
import * as Sentry from '@/src/lib/errors/sentry';

jest.mock('@/src/lib/errors/sentry', () => ({
  captureException: jest.fn(),
  captureSentryException: jest.fn(),
  addSentryBreadcrumb: jest.fn()
}));

describe('CohortAnalysisDashboard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders loading state initially', () => {
    render(<CohortAnalysisDashboard />);
    expect(screen.getByTestId('cohort-loading')).toBeInTheDocument();
  });

  it('renders data when pipeline is successful', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve([{ id: '1', name: 'Cohort A', retention: 85 }]),
      })
    ) as jest.Mock;

    render(<CohortAnalysisDashboard />);
    await waitFor(() => {
      expect(screen.getByTestId('cohort-dashboard')).toBeInTheDocument();
      expect(screen.getByTestId('cohort-item-1')).toHaveTextContent('Cohort A - 85% Retention');
    });
    expect(Sentry.addSentryBreadcrumb).toHaveBeenCalled();
  });

  it('activates fallback system and logs error on failure', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('Network error'))) as jest.Mock;

    render(<CohortAnalysisDashboard />);
    await waitFor(() => {
      expect(screen.getByTestId('cohort-error')).toHaveTextContent('Fallback system activated: Unable to load cohort data securely.');
    });
    expect(Sentry.captureSentryException).toHaveBeenCalled();
  });
});
