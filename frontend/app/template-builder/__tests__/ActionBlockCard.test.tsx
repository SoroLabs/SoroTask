import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ActionBlockCard } from '../../template-builder/components/ActionBlockCard';
import { ActionBlock } from '../../template-builder/types';

const BASE_BLOCK: ActionBlock = {
  instanceId: 'inst-1',
  definitionId: 'harvest-yield',
  label: 'Harvest Yield',
  category: 'defi',
  icon: '🌾',
  contractAddress: 'CPOOL',
  functionName: 'harvest',
  inputs: [
    { name: 'pool_id', type: 'address' },
    { name: 'min_amount', type: 'i128', optional: true },
  ],
  args: {},
  isConfigured: false,
};

const DEFAULTS = {
  block: BASE_BLOCK,
  index: 0,
  onRemove: jest.fn(),
  onArgChange: jest.fn(),
  onContractChange: jest.fn(),
  onDragStart: jest.fn(),
  onDrop: jest.fn(),
};

function renderCard(overrides: Partial<typeof DEFAULTS> = {}) {
  return render(<ActionBlockCard {...DEFAULTS} {...overrides} />);
}

describe('ActionBlockCard', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders block label and step number', () => {
    renderCard();
    expect(screen.getByText('Harvest Yield')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument(); // step indicator
  });

  it('renders category badge', () => {
    renderCard();
    expect(screen.getByText('defi')).toBeInTheDocument();
  });

  it('renders contract address input pre-filled', () => {
    renderCard();
    const input = screen.getByLabelText('Contract Address') as HTMLInputElement;
    expect(input.value).toBe('CPOOL');
  });

  it('renders input fields for each param', () => {
    renderCard();
    expect(screen.getByLabelText(/pool_id/)).toBeInTheDocument();
    expect(screen.getByLabelText(/min_amount/)).toBeInTheDocument();
  });

  it('renders a select for boolean parameters', () => {
    renderCard({
      block: {
        ...BASE_BLOCK,
        inputs: [{ name: 'approve', type: 'bool' }],
        args: {},
      },
    });
    expect(screen.getByLabelText(/approve/)).toBeInstanceOf(HTMLSelectElement);
  });

  it('shows "Needs input" when not configured', () => {
    renderCard();
    expect(screen.getByText('Needs input')).toBeInTheDocument();
  });

  it('shows "Configured" when isConfigured is true', () => {
    renderCard({ block: { ...BASE_BLOCK, isConfigured: true } });
    expect(screen.getByText('Configured')).toBeInTheDocument();
  });

  it('calls onRemove when × button is clicked', () => {
    const onRemove = jest.fn();
    renderCard({ onRemove });
    fireEvent.click(screen.getByLabelText('Remove Harvest Yield block'));
    expect(onRemove).toHaveBeenCalledWith('inst-1');
  });

  it('calls onArgChange when an arg input changes', () => {
    const onArgChange = jest.fn();
    renderCard({ onArgChange });
    const input = screen.getByLabelText(/pool_id/);
    fireEvent.change(input, { target: { value: 'CADDR' } });
    expect(onArgChange).toHaveBeenCalledWith('inst-1', 'pool_id', 'CADDR');
  });

  it('calls onContractChange when contract address input changes', () => {
    const onContractChange = jest.fn();
    renderCard({ onContractChange });
    const input = screen.getByLabelText('Contract Address');
    fireEvent.change(input, { target: { value: 'CNEW' } });
    expect(onContractChange).toHaveBeenCalledWith('inst-1', 'CNEW');
  });

  it('uses correct step number for non-zero index', () => {
    renderCard({ index: 3 });
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('shows function name', () => {
    renderCard();
    expect(screen.getByText(/harvest/)).toBeInTheDocument();
  });

  it('renders block with no inputs without crashing', () => {
    const noInputBlock: ActionBlock = {
      ...BASE_BLOCK,
      inputs: [],
      isConfigured: true,
    };
    renderCard({ block: noInputBlock });
    expect(screen.getByText('Configured')).toBeInTheDocument();
  });
});
