import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { KeeperCard } from '../../marketplace/components/KeeperCard';
import { Keeper } from '../../marketplace/types';

const ONLINE_KEEPER: Keeper = {
  id: 'k1',
  address: 'GABC1LONGADDRESS',
  label: 'AlphaBot',
  tier: 'platinum',
  reliabilityScore: 98,
  totalExecutions: 12400,
  successRate: 99.1,
  medianLatencyMs: 320,
  minBidXlm: 0.5,
  isOnline: true,
  lastActiveAt: new Date().toISOString(),
};

const OFFLINE_KEEPER: Keeper = {
  ...ONLINE_KEEPER,
  id: 'k2',
  label: 'BetaKeeper',
  isOnline: false,
};

function renderCard(keeper: Keeper, activeBidCount = 0, onBid = jest.fn()) {
  return render(<KeeperCard keeper={keeper} activeBidCount={activeBidCount} onBid={onBid} />);
}

describe('KeeperCard', () => {
  it('renders keeper label', () => {
    renderCard(ONLINE_KEEPER);
    expect(screen.getByText('AlphaBot')).toBeInTheDocument();
  });

  it('renders truncated address', () => {
    renderCard(ONLINE_KEEPER);
    expect(screen.getByText('GABC1L…RESS')).toBeInTheDocument();
  });

  it('renders tier badge', () => {
    renderCard(ONLINE_KEEPER);
    expect(screen.getByText(/Platinum/i)).toBeInTheDocument();
  });

  it('shows Online indicator when online', () => {
    renderCard(ONLINE_KEEPER);
    expect(screen.getByText('Online')).toBeInTheDocument();
  });

  it('shows Offline indicator when offline', () => {
    renderCard(OFFLINE_KEEPER);
    expect(screen.getByText('Offline')).toBeInTheDocument();
  });

  it('renders reliability score', () => {
    renderCard(ONLINE_KEEPER);
    expect(screen.getByText('98%')).toBeInTheDocument();
  });

  it('renders success rate', () => {
    renderCard(ONLINE_KEEPER);
    expect(screen.getByText('99.1%')).toBeInTheDocument();
  });

  it('renders latency', () => {
    renderCard(ONLINE_KEEPER);
    expect(screen.getByText('320 ms')).toBeInTheDocument();
  });

  it('renders execution count', () => {
    renderCard(ONLINE_KEEPER);
    expect(screen.getByText('12,400')).toBeInTheDocument();
  });

  it('renders min bid', () => {
    renderCard(ONLINE_KEEPER);
    expect(screen.getByText('0.5 XLM')).toBeInTheDocument();
  });

  it('Place Bid button is enabled when online', () => {
    renderCard(ONLINE_KEEPER);
    const btn = screen.getByRole('button', { name: /Place Bid/i });
    expect(btn).not.toBeDisabled();
  });

  it('Place Bid button is disabled when offline', () => {
    renderCard(OFFLINE_KEEPER);
    const btn = screen.getByRole('button', { name: /Place Bid/i });
    expect(btn).toBeDisabled();
  });

  it('calls onBid with keeper when button is clicked', () => {
    const onBid = jest.fn();
    renderCard(ONLINE_KEEPER, 0, onBid);
    fireEvent.click(screen.getByRole('button', { name: /Place Bid/i }));
    expect(onBid).toHaveBeenCalledWith(ONLINE_KEEPER);
  });

  it('shows active bid count in button label', () => {
    renderCard(ONLINE_KEEPER, 3);
    expect(screen.getByText('Bid (3 active)')).toBeInTheDocument();
  });

  it('has correct data-testid', () => {
    renderCard(ONLINE_KEEPER);
    expect(screen.getByTestId('keeper-card-k1')).toBeInTheDocument();
  });

  it('falls back to truncated address when label is absent', () => {
    const noLabel: Keeper = { ...ONLINE_KEEPER, label: undefined };
    renderCard(noLabel);
    expect(screen.getAllByText('GABC1L…RESS').length).toBeGreaterThanOrEqual(1);
  });
});
