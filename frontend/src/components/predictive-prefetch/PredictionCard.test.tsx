import { render, screen } from '@testing-library/react';
import { PredictionCard } from './PredictionCard';

describe('PredictionCard', () => {
  const mockFetch = jest.fn();
  const input = {
    contractAddress: `C${'A'.repeat(55)}`,
    functionName: 'harvest_yield',
    interval: '3600',
    gasBalance: '10',
  };

  beforeEach(() => {
    mockFetch.mockReset();
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: mockFetch,
    });
  });

  afterEach(() => {
    mockFetch.mockReset();
  });

  it('explains that all task details are needed before checking', () => {
    render(<PredictionCard input={{ ...input, contractAddress: '' }} />);

    expect(screen.getByText(/enter the contract, function, interval, and gas balance/i)).toBeInTheDocument();
  });

  it('shows risk factors and recommendations from the diagnostic service', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        riskScore: 60,
        confidence: 100,
        riskLevel: 'high',
        riskFactors: [{
          id: 'gas-balance-empty',
          severity: 'high',
          title: 'No gas balance is configured',
          description: 'A task without a positive gas balance cannot fund execution.',
          recommendation: 'Add a positive gas balance before registering this task.',
        }],
        limitations: ['This is a heuristic estimate.'],
      }),
    });

    render(<PredictionCard input={input} />);

    expect(await screen.findByText(/high configuration risk/i)).toBeInTheDocument();
    expect(screen.getByText('No gas balance is configured')).toBeInTheDocument();
    expect(screen.getByText(/Add a positive gas balance/)).toBeInTheDocument();
    expect(screen.getByText('100% input coverage')).toBeInTheDocument();
    expect(screen.getByText(/not an ML model or transaction simulation/i)).toBeInTheDocument();
  });

  it('reports diagnostic service failures instead of showing an empty success state', async () => {
    mockFetch.mockRejectedValue(new Error('Network unavailable'));

    render(<PredictionCard input={input} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Diagnostics unavailable: Network unavailable',
    );
  });
});
