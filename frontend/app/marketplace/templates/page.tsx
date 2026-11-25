import type { Metadata } from 'next';
import { TemplateMarketplacePage } from './TemplateMarketplacePage';

export const metadata: Metadata = {
  title: 'Task Template Marketplace | SoroTask',
  description:
    'Fork a verified community task template, customise its parameters, and deploy the whole flow as one batched transaction.',
};

export default function Page() {
  return <TemplateMarketplacePage />;
}
