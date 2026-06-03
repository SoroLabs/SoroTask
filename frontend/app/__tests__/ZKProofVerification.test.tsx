import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import ZKProofVerification, { ZkTask } from '../components/ZKProofVerification';

const mockTasks: ZkTask[] = [
  {
    id: 1,
    contractAddress: 'CABCDEF1234',
    functionName: 'harvest_yield',
    interval: 3600,
    gasBalance: 10,
    status: 'active',
  },
  {
    id: 2,
    contractAddress: 'CXYZ5678FAILS',
    functionName: 'claim_yield',
    interval: 600,
    gasBalance: 5,
    status: 'active',
  }
];

describe('ZKProofVerification Component', () => {
  const mockOnZkVerified = jest.fn();
  const mockOnAddLog = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders header text and options correctly', () => {
    render(
      <ZKProofVerification
        tasks={mockTasks}
        walletConnected={false}
        walletAddress={null}
        onZkVerified={mockOnZkVerified}
        onAddLog={mockOnAddLog}
      />
    );

    expect(screen.getByText('Zero-Knowledge (ZK) Proof Verification')).toBeInTheDocument();
    expect(screen.getByText('-- Choose registered task --')).toBeInTheDocument();
  });

  it('shows warnings when no tasks are loaded', () => {
    render(
      <ZKProofVerification
        tasks={[]}
        walletConnected={false}
        walletAddress={null}
        onZkVerified={mockOnZkVerified}
        onAddLog={mockOnAddLog}
      />
    );

    expect(screen.getByText('⚠️ No registered tasks available. Create a task first.')).toBeInTheDocument();
  });

  it('navigates between Workspace and Diagnostics tabs', () => {
    render(
      <ZKProofVerification
        tasks={mockTasks}
        walletConnected={false}
        walletAddress={null}
        onZkVerified={mockOnZkVerified}
        onAddLog={mockOnAddLog}
      />
    );

    const diagnosticsTab = screen.getByRole('button', { name: /Diagnostics/i });
    fireEvent.click(diagnosticsTab);

    expect(screen.getByText('Resilient Fallback & Diagnostics Hub')).toBeInTheDocument();
    expect(screen.getByText('System Healthy')).toBeInTheDocument();

    const workspaceTab = screen.getByRole('button', { name: /Workspace/i });
    fireEvent.click(workspaceTab);
    expect(screen.getByText('1. ZK Generation Setup')).toBeInTheDocument();
  });

  it('generates ZK proof successfully in workspace', async () => {
    render(
      <ZKProofVerification
        tasks={mockTasks}
        walletConnected={true}
        walletAddress="GABC...XYZ"
        onZkVerified={mockOnZkVerified}
        onAddLog={mockOnAddLog}
      />
    );

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: '1' } });

    const generateButton = screen.getByRole('button', { name: 'Generate Zero-Knowledge Proof' });
    fireEvent.click(generateButton);

    // Initial log
    expect(screen.getByText(/Initializing off-chain proof generation pipeline/i)).toBeInTheDocument();

    // Advance mock timers to generate logs inside act
    act(() => {
      jest.advanceTimersByTime(300); // step 1
    });
    act(() => {
      jest.advanceTimersByTime(300); // step 2
    });
    act(() => {
      jest.advanceTimersByTime(300); // step 3 (generates standard proof)
    });

    await waitFor(() => {
      expect(screen.getByText(/ZK Proof Computed Successfully/i)).toBeInTheDocument();
      expect(screen.getByText(/Copy Proof JSON/i)).toBeInTheDocument();
    });
  });

  it('handles simulated computational proof failure and registers diagnostics error', async () => {
    render(
      <ZKProofVerification
        tasks={mockTasks}
        walletConnected={true}
        walletAddress="GABC...XYZ"
        onZkVerified={mockOnZkVerified}
        onAddLog={mockOnAddLog}
      />
    );

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: '1' } });

    // Toggle simulation failure checkbox
    const failureCheckbox = screen.getByLabelText('Simulate Computational Proof Failure');
    fireEvent.click(failureCheckbox);

    const generateButton = screen.getByRole('button', { name: 'Generate Zero-Knowledge Proof' });
    fireEvent.click(generateButton);

    act(() => {
      jest.advanceTimersByTime(600); // advance through initial steps
    });

    await waitFor(() => {
      expect(screen.getByText(/Computational failure detected inside proof computation/i)).toBeInTheDocument();
    });

    // Check Diagnostics tab for the logged error
    const diagnosticsTab = screen.getByRole('button', { name: /Diagnostics/i });
    fireEvent.click(diagnosticsTab);

    expect(screen.getByText('Constraint validation mismatch: Coefficient multiplier check failed at wire #12')).toBeInTheDocument();
    expect(screen.getByText(/Ensure client inputs satisfy task condition threshold rules/i)).toBeInTheDocument();
  });

  it('runs the full on-chain verify pipeline successfully and alerts parent callbacks', async () => {
    render(
      <ZKProofVerification
        tasks={mockTasks}
        walletConnected={true}
        walletAddress="GABC123"
        onZkVerified={mockOnZkVerified}
        onAddLog={mockOnAddLog}
      />
    );

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: '1' } });

    const generateButton = screen.getByRole('button', { name: 'Generate Zero-Knowledge Proof' });
    fireEvent.click(generateButton);

    act(() => {
      jest.advanceTimersByTime(900); // Wait for ZK proof to generate
    });

    await waitFor(() => {
      expect(screen.getByText('Submit & Verify Proof On-Chain')).toBeInTheDocument();
    });

    const verifyButton = screen.getByText('Submit & Verify Proof On-Chain');
    fireEvent.click(verifyButton);

    act(() => {
      jest.advanceTimersByTime(1200); // Advance through all contract verify phases
    });

    await waitFor(() => {
      expect(screen.getByText('🛡️ Verified & Secured On-Chain')).toBeInTheDocument();
      expect(mockOnZkVerified).toHaveBeenCalledWith(1, expect.any(String));
      expect(mockOnAddLog).toHaveBeenCalled();
    });
  });

  it('handles simulated contract verification revert on specific contract targets', async () => {
    render(
      <ZKProofVerification
        tasks={mockTasks}
        walletConnected={true}
        walletAddress="GABC123"
        onZkVerified={mockOnZkVerified}
        onAddLog={mockOnAddLog}
      />
    );

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: '2' } }); // Task 2 contractAddress contains 'FAILS'

    const generateButton = screen.getByRole('button', { name: 'Generate Zero-Knowledge Proof' });
    fireEvent.click(generateButton);

    act(() => {
      jest.advanceTimersByTime(900); // Wait for ZK proof to generate
    });

    await waitFor(() => {
      expect(screen.getByText('Submit & Verify Proof On-Chain')).toBeInTheDocument();
    });

    const verifyButton = screen.getByText('Submit & Verify Proof On-Chain');
    fireEvent.click(verifyButton);

    act(() => {
      jest.advanceTimersByTime(1200); // Wait for verification phases to run
    });

    await waitFor(() => {
      expect(screen.getByText(/On-chain verifier rejected the proof validity/i)).toBeInTheDocument();
    });

    // Check Diagnostics tab
    const diagnosticsTab = screen.getByRole('button', { name: /Diagnostics/i });
    fireEvent.click(diagnosticsTab);

    expect(screen.getByText(/Soroban Transaction Revert/i)).toBeInTheDocument();
  });

  it('supports clipboard diagnostics copying utility', async () => {
    // Mock navigator clipboard API
    const writeTextMock = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    window.alert = jest.fn();

    render(
      <ZKProofVerification
        tasks={mockTasks}
        walletConnected={true}
        walletAddress="GABC123"
        onZkVerified={mockOnZkVerified}
        onAddLog={mockOnAddLog}
      />
    );

    const diagnosticsTab = screen.getByRole('button', { name: /Diagnostics/i });
    fireEvent.click(diagnosticsTab);

    const copyBtn = screen.getByText('📋 Copy Diagnostic Report');
    fireEvent.click(copyBtn);

    expect(writeTextMock).toHaveBeenCalled();
    expect(window.alert).toHaveBeenCalledWith('Diagnostic report copied to clipboard!');
  });
});
