import { render, screen } from '@testing-library/react';
import { Modal, ModalFooter } from '@/components/Modal';

describe('Modal', () => {
  const onClose = jest.fn();

  beforeEach(() => jest.clearAllMocks());

  it('renders nothing when closed', () => {
    render(
      <Modal open={false} onClose={onClose} title="Test Modal">
        <p>body</p>
      </Modal>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders title and children when open', () => {
    render(
      <Modal open onClose={onClose} title="Wallet Modal">
        <p>modal body</p>
      </Modal>,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Wallet Modal')).toBeInTheDocument();
    expect(screen.getByText('modal body')).toBeInTheDocument();
  });

  it('renders footer content', () => {
    render(
      <Modal
        open
        onClose={onClose}
        title="Title"
        footer={
          <ModalFooter>
            <button type="button">Confirm</button>
          </ModalFooter>
        }
      >
        <p>body</p>
      </Modal>,
    );
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
  });

  it('blocks backdrop close while loading', () => {
    render(
      <Modal open onClose={onClose} title="Loading Modal" isLoading>
        <p>body</p>
      </Modal>,
    );
    expect(screen.getByTestId('dialog-panel')).toBeInTheDocument();
  });
});
