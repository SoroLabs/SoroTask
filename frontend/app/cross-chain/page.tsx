import type { Metadata, Viewport } from 'next';
import { CrossChainTaskManager } from './components/CrossChainTaskManager';

export const metadata: Metadata = {
  title: 'Cross-Chain Tasks | SoroTask',
  description: 'Manage and monitor tasks spanning Soroban and other integrated networks.',
};

export const viewport: Viewport = {
  themeColor: '#0f172a',
  width: 'device-width',
  initialScale: 1,
};

export default function CrossChainPage() {
  return <CrossChainTaskManager />;
}
