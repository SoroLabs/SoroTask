import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import CollaborativeWorkspace from '../CollaborativeWorkspace';

describe('CollaborativeWorkspace Component', () => {
  it('renders collaborative workspace header and presence indicators', () => {
    render(<CollaborativeWorkspace taskId="task-test-101" userName="Alice" />);

    expect(screen.getByText(/Shared Automation Document \(Task #task-test-101\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Multi-Sig CRDT Collaborative Workspace/i)).toBeInTheDocument();
    expect(screen.getByTitle(/Alice \(You\)/i)).toBeInTheDocument();
  });

  it('allows editing parameters and triggers 1-click apply', () => {
    const handleApply = jest.fn();
    render(
      <CollaborativeWorkspace
        taskId="task-test-101"
        userName="Bob"
        onApplyParameters={handleApply}
      />
    );

    const contractInput = screen.getByPlaceholderText(/56 chars contract address/i);
    fireEvent.change(contractInput, {
      target: { value: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC' },
    });
    expect(contractInput).toHaveValue('CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC');

    const applyButton = screen.getByText(/1-Click Apply Parameters/i);
    fireEvent.click(applyButton);

    expect(handleApply).toHaveBeenCalledTimes(1);
    expect(handleApply).toHaveBeenCalledWith(
      expect.objectContaining({
        contractAddress: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
      })
    );
  });
});
