import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TargetSecurityWarningModal } from '@/src/components/TargetSecurityWarningModal';
import { scanTargetContract } from '@/src/lib/phishing-mitigation';

const GOOD = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const SCAM = 'GB2XDSWHTYCWQL3F36HYJ4XWWDKJRVLSGY5RRCQMAJTCXJPBMPHSHDWQ';

function renderModal(scan = scanTargetContract({ address: SCAM })) {
  const onProceed = jest.fn();
  const onClose = jest.fn();
  render(
    <TargetSecurityWarningModal open onClose={onClose} scan={scan} onProceed={onProceed} />,
  );
  return { onProceed, onClose };
}

describe('TargetSecurityWarningModal', () => {
  it('shows the full target address so it can be compared', () => {
    renderModal();
    expect(screen.getByTestId('target-address')).toHaveTextContent(SCAM);
  });

  it('lists every finding from the scan', () => {
    renderModal();
    expect(screen.getByTestId('target-findings')).toBeInTheDocument();
    expect(screen.getByText(/Drainer/)).toBeInTheDocument();
  });

  it('uses high-risk wording for a critical scan', () => {
    renderModal();
    expect(screen.getByText('High-risk contract')).toBeInTheDocument();
    expect(screen.getByTestId('target-proceed')).toHaveTextContent('Continue anyway');
  });

  it('blocks the override until the risk is acknowledged', async () => {
    const { onProceed } = renderModal();
    const proceed = screen.getByTestId('target-proceed');

    expect(proceed).toBeDisabled();
    await userEvent.click(proceed);
    expect(onProceed).not.toHaveBeenCalled();
  });

  it('allows the override once acknowledged', async () => {
    const { onProceed } = renderModal();

    await userEvent.click(screen.getByTestId('target-acknowledge'));
    expect(screen.getByTestId('target-proceed')).toBeEnabled();

    await userEvent.click(screen.getByTestId('target-proceed'));
    expect(onProceed).toHaveBeenCalledTimes(1);
  });

  it('does not proceed when cancelled', async () => {
    const { onProceed, onClose } = renderModal();

    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onProceed).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('omits the acknowledgement box for a non-critical scan', () => {
    const caution = scanTargetContract({ address: GOOD });
    renderModal(caution);

    expect(screen.queryByTestId('target-acknowledge')).not.toBeInTheDocument();
    expect(screen.getByTestId('target-proceed')).toBeEnabled();
  });

  it('says so plainly when nothing was found', () => {
    const clean = scanTargetContract({
      address: GOOD,
      verifiedContracts: [GOOD],
      hasVerifiedSource: true,
    });
    renderModal(clean);

    expect(screen.getByText(/No issues were found/)).toBeInTheDocument();
  });
});
