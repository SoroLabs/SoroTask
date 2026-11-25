import type { Metadata } from 'next';
import { ErrorResolutionWizard } from './components/ErrorResolutionWizard';

export const metadata: Metadata = {
  title: 'Error Resolution Wizard | SoroTask',
  description: 'Step-by-step guidance to fix failing task configurations.',
};

export default function ErrorWizardPage() {
  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10">
      <ErrorResolutionWizard />
    </main>
  );
}
