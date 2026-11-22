import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CreateTaskWizardPage from '../page';
import { useStellarWallet } from '@/context/StellarWalletContext';
import { simulateTaskCall } from '@/src/lib/soroban/task-simulation';

jest.mock('@/context/StellarWalletContext');
jest.mock('@/src/lib/soroban/task-simulation', () => ({
  formatXlm: (stroops: string) => (Number(stroops) / 10_000_000).toFixed(7),
  simulateTaskCall: jest.fn().mockResolvedValue({
    minResourceFeeStroops: '50000',
    networkFeeStroops: '10000',
    totalFeeStroops: '60000',
    cpuInstructions: 145000,
    storageReadBytes: 2048,
    storageWriteBytes: 1024,
    readOnlyEntries: 2,
    readWriteEntries: 1,
    stateChanges: { created: 1, updated: 1, removed: 0 },
    trace: [{ step: 'Invoke execute_task', detail: 'Contract C...' }],
  }),
}));

describe('CreateTaskWizardPage', () => {
  beforeEach(() => {
    (useStellarWallet as jest.Mock).mockReturnValue({
      address: 'GSOURCE123',
      isConnected: true,
      network: 'TESTNET',
    });
    (simulateTaskCall as jest.Mock).mockClear();
  });

  it('renders step 1 by default and validates navigation', () => {
    render(<CreateTaskWizardPage />);

    expect(
      screen.getByRole('heading', { name: /step 1: specify target soroban contract/i })
    ).toBeInTheDocument();

    const input = screen.getByPlaceholderText(/CA7Q3/i);
    fireEvent.change(input, { target: { value: 'CA7Q31234567890' } });

    fireEvent.click(screen.getByRole('button', { name: /next step/i }));

    expect(
      screen.getByRole('heading', { name: /step 2: function selection & arguments/i })
    ).toBeInTheDocument();
  });

  it('automatically simulates on step 3 and requires success before advancing', async () => {
    render(<CreateTaskWizardPage />);

    // Advance to step 2
    fireEvent.change(screen.getByPlaceholderText(/CA7Q3/i), {
      target: { value: 'CA7Q31234567890' },
    });
    fireEvent.click(screen.getByRole('button', { name: /next step/i }));

    // Advance to step 3
    fireEvent.click(screen.getByRole('button', { name: /next step/i }));
    expect(
      screen.getByRole('heading', { name: /step 3: trigger interval & pre-flight simulation/i })
    ).toBeInTheDocument();

    const nextBtn = screen.getByRole('button', { name: /next step/i });
    expect(nextBtn).toBeDisabled();

    await waitFor(() => {
      expect(screen.getByText(/✓ Simulation Successful/i)).toBeInTheDocument();
    }, { timeout: 3000 });

    expect(simulateTaskCall).toHaveBeenCalledWith(expect.objectContaining({
      sourceAddress: 'GSOURCE123',
      network: 'testnet',
    }));
    expect(screen.getByText(/Storage I\/O: 2048 bytes read \/ 1024 bytes written/)).toBeInTheDocument();
    expect(nextBtn).not.toBeDisabled();
  });

  it('reruns pre-flight simulation when the function call changes', async () => {
    render(<CreateTaskWizardPage />);

    fireEvent.change(screen.getByPlaceholderText(/CA7Q3/i), {
      target: { value: 'CA7Q31234567890' },
    });
    fireEvent.click(screen.getByRole('button', { name: /next step/i }));

    const functionInput = screen.getByPlaceholderText(/execute_cron/i);
    fireEvent.change(functionInput, { target: { value: 'execute_task' } });
    fireEvent.click(screen.getByRole('button', { name: /next step/i }));

    await waitFor(() => {
      expect(simulateTaskCall).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    fireEvent.change(screen.getByPlaceholderText(/execute_cron/i), {
      target: { value: 'another_function' },
    });
    fireEvent.click(screen.getByRole('button', { name: /next step/i }));

    await waitFor(() => {
      expect(simulateTaskCall).toHaveBeenCalledTimes(2);
    });
  });
});