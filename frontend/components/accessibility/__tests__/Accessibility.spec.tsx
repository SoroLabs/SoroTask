import React from 'react';
import { render } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { AccessibleModal } from '../AccessibleModal';
import { AccessibleDataTable } from '../AccessibleDataTable';

expect.extend(toHaveNoViolations);

describe('WCAG 2.1 AA Automated axe-core Audits', () => {
  it('AccessibleModal should have no accessibility violations', async () => {
    const { container } = render(
      <AccessibleModal isOpen={true} onClose={() => {}} title="Test Accessible Modal">
        <p>Modal content body</p>
      </AccessibleModal>,
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('AccessibleDataTable should have no accessibility violations', async () => {
    const columns = [
      { header: 'ID', accessor: 'id' as const },
      { header: 'Status', accessor: 'status' as const },
    ];
    const data = [{ id: '1', status: 'Active' }];

    const { container } = render(
      <AccessibleDataTable
        caption="Active Soroban Tasks"
        columns={columns}
        data={data}
      />,
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});