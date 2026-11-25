import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import KeeperDashboardPage from '../page';

// Mock Recharts ResponsiveContainer to allow rendering in jsdom
jest.mock('recharts', () => {
  const OriginalModule = jest.requireActual('recharts');
  return {
    ...OriginalModule,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 800, height: 320 }}>{children}</div>
    ),
  };
});

describe('KeeperDashboardPage', () => {
  it('renders summary metrics and export controls correctly', () => {
    render(<KeeperDashboardPage />);

    expect(screen.getByRole('heading', { name: /keeper performance analytics/i })).toBeInTheDocument();
    expect(screen.getByText('+1091 XLM')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /export csv/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /export json/i })).toBeInTheDocument();
  });

  it('triggers file download on CSV export button click', () => {
    const appendChildSpy = jest.spyOn(document.body, 'appendChild');
    render(<KeeperDashboardPage />);

    const exportCsvBtn = screen.getByRole('button', { name: /export csv/i });
    fireEvent.click(exportCsvBtn);

    expect(appendChildSpy).toHaveBeenCalled();
  });
});