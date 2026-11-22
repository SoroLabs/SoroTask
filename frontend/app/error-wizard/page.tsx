import type { Metadata, Viewport } from 'next';
import { ErrorResolutionWizard } from './components/ErrorResolutionWizard';

export const metadata: Metadata = {
  title: 'Error Resolution Wizard | SoroTask',
  description: 'Step-by-step guidance to fix failing task configurations.',
};

export const viewport: Viewport = {
  themeColor: '#0f172a',
  width: 'device-width',
  initialScale: 1,
};

export default function ErrorWizardPage() {
  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10">
      <ErrorResolutionWizard />
    </main>
  );
}
