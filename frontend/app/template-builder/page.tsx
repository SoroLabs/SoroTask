import type { Metadata } from 'next';
import { TemplateBuilder } from './components/TemplateBuilder';

export const metadata: Metadata = {
  title: 'Task Template Builder | SoroTask',
  description:
    'Compose complex task execution flows using pre-defined actions or import a Soroban contract ABI to generate a validated form.',
};

export default function TemplateBuilderPage() {
  return (
    <main className="h-screen bg-neutral-950 flex flex-col overflow-hidden">
      <TemplateBuilder />
    </main>
  );
}
