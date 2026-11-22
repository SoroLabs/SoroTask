import type { Metadata, Viewport } from 'next';
import { KeeperMarketplace } from './components/KeeperMarketplace';

export const metadata: Metadata = {
  title: 'Keeper Marketplace | SoroTask',
  description: 'Browse keeper profiles, view reliability stats, and place bids for priority task execution.',
};

export const viewport: Viewport = {
  themeColor: '#0f172a',
  width: 'device-width',
  initialScale: 1,
};

export default function MarketplacePage() {
  return <KeeperMarketplace />;
}
