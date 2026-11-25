import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ActionPalette } from '../../template-builder/components/ActionPalette';
import { AbiParseResult, ContractAbi } from '../../template-builder/types';

const noop = jest.fn();
const noopImport = jest.fn(() => ({ success: true } as AbiParseResult));

function renderPalette(
  importedAbis: ContractAbi[] = [],
  overrides: Partial<{ onAddBlock: jest.Mock; onImportAbi: jest.Mock }> = {},
) {
  return render(
    <ActionPalette
      importedAbis={importedAbis}
      onAddBlock={overrides.onAddBlock ?? noop}
      onImportAbi={overrides.onImportAbi ?? noopImport}
    />,
  );
}

describe('ActionPalette', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders all pre-defined actions by default', () => {
    renderPalette();
    expect(screen.getByTestId('palette-action-harvest-yield')).toBeInTheDocument();
    expect(screen.getByTestId('palette-action-token-transfer')).toBeInTheDocument();
    expect(screen.getByTestId('palette-action-swap')).toBeInTheDocument();
  });

  it('clicking an action calls onAddBlock with the definition', () => {
    const onAddBlock = jest.fn();
    renderPalette([], { onAddBlock });
    fireEvent.click(screen.getByTestId('palette-action-harvest-yield'));
    expect(onAddBlock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'harvest-yield', label: 'Harvest Yield' }),
    );
  });

  it('filters to defi category when defi tab is clicked', () => {
    renderPalette();
    fireEvent.click(screen.getByRole('button', { name: 'defi' }));
    expect(screen.getByTestId('palette-action-harvest-yield')).toBeInTheDocument();
    // transfer action should not be visible
    expect(screen.queryByTestId('palette-action-token-transfer')).not.toBeInTheDocument();
  });

  it('filters to transfer category', () => {
    renderPalette();
    fireEvent.click(screen.getByRole('button', { name: 'transfer' }));
    expect(screen.getByTestId('palette-action-token-transfer')).toBeInTheDocument();
    expect(screen.queryByTestId('palette-action-harvest-yield')).not.toBeInTheDocument();
  });

  it('shows custom actions derived from importedAbis', () => {
    const abi: ContractAbi = {
      contractAddress: 'CXYZ',
      label: 'My Protocol',
      functions: [{ name: 'my_fn', inputs: [] }],
    };
    renderPalette([abi]);
    fireEvent.click(screen.getByRole('button', { name: 'custom' }));
    expect(screen.getByTestId('palette-action-custom-CXYZ-my_fn')).toBeInTheDocument();
  });

  it('shows empty message when no actions match a category', () => {
    renderPalette();
    fireEvent.click(screen.getByRole('button', { name: 'custom' }));
    expect(screen.getByText(/No actions in this category/)).toBeInTheDocument();
  });

  it('calls onImportAbi when Import is clicked with data', () => {
    const onImportAbi = jest.fn(() => ({ success: true } as AbiParseResult));
    renderPalette([], { onImportAbi });

    fireEvent.change(screen.getByLabelText('Contract address for ABI import'), {
      target: { value: 'CADDR' },
    });
    fireEvent.change(screen.getByLabelText('ABI JSON'), {
      target: { value: '[{"name":"fn","inputs":[]}]' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));

    expect(onImportAbi).toHaveBeenCalledWith(
      '[{"name":"fn","inputs":[]}]',
      'CADDR',
      undefined,
    );
  });

  it('shows import error when onImportAbi returns failure', () => {
    const onImportAbi = jest.fn(
      () => ({ success: false, error: 'Bad JSON' } as AbiParseResult),
    );
    renderPalette([], { onImportAbi });

    fireEvent.change(screen.getByLabelText('ABI JSON'), {
      target: { value: 'broken' },
    });
    fireEvent.change(screen.getByLabelText('Contract address for ABI import'), {
      target: { value: 'CADDR' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Bad JSON');
  });

  it('shows success message after successful import', () => {
    const onImportAbi = jest.fn(() => ({ success: true } as AbiParseResult));
    renderPalette([], { onImportAbi });

    fireEvent.change(screen.getByLabelText('ABI JSON'), {
      target: { value: '[{"name":"fn","inputs":[]}]' },
    });
    fireEvent.change(screen.getByLabelText('Contract address for ABI import'), {
      target: { value: 'CADDR' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));

    expect(screen.getByRole('status')).toHaveTextContent('ABI imported');
  });

  it('shows validation error when Import clicked with empty JSON', () => {
    renderPalette();
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/Paste/);
  });

  it('passes label to onImportAbi when provided', () => {
    const onImportAbi = jest.fn(() => ({ success: true } as AbiParseResult));
    renderPalette([], { onImportAbi });

    fireEvent.change(screen.getByLabelText('Contract address for ABI import'), {
      target: { value: 'CADDR' },
    });
    fireEvent.change(screen.getByLabelText('Label for imported ABI'), {
      target: { value: 'My Protocol' },
    });
    fireEvent.change(screen.getByLabelText('ABI JSON'), {
      target: { value: '[{"name":"fn","inputs":[]}]' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));

    expect(onImportAbi).toHaveBeenCalledWith(
      '[{"name":"fn","inputs":[]}]',
      'CADDR',
      'My Protocol',
    );
  });
});
