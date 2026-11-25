/**
 * Tests for AIChat component
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AIChat } from '@/app/components/AIChat';
import * as useAIAssistantHook from '@/src/hooks/useAIAssistant';

// Mock the hook
jest.mock('@/src/hooks/useAIAssistant');

describe('AIChat Component', () => {
  let mockUseAIAssistant: any;

  beforeEach(() => {
    mockUseAIAssistant = {
      messages: [],
      isLoading: false,
      error: null,
      taskConfig: null,
      generatedABI: null,
      sendMessage: jest.fn(),
      generateTaskConfig: jest.fn(),
      generateABI: jest.fn(),
      clearMessages: jest.fn(),
      clearError: jest.fn(),
      resetState: jest.fn(),
    };

    (useAIAssistantHook.useAIAssistant as jest.Mock).mockReturnValue(
      mockUseAIAssistant
    );
  });

  describe('rendering', () => {
    it('should render chat interface with initial message', () => {
      render(<AIChat />);

      expect(
        screen.getByText(
          /Hi! I can help you create a task configuration/
        )
      ).toBeInTheDocument();
    });

    it('should render input field and send button', () => {
      render(<AIChat />);

      expect(
        screen.getByPlaceholderText(/Describe your automation task/)
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Send/ })).toBeInTheDocument();
    });

    it('should render custom initial message', () => {
      const customMessage = 'Custom greeting';
      render(<AIChat initialMessage={customMessage} />);

      expect(screen.getByText(customMessage)).toBeInTheDocument();
    });
  });

  describe('message interaction', () => {
    it('should send message on form submit', async () => {
      render(<AIChat />);

      const input = screen.getByPlaceholderText(
        /Describe your automation task/
      );
      const sendButton = screen.getByRole('button', { name: /Send/ });

      fireEvent.change(input, {
        target: { value: 'Test message' },
      });
      fireEvent.click(sendButton);

      expect(mockUseAIAssistant.sendMessage).toHaveBeenCalledWith('Test message');
    });

    it('should clear input after sending', () => {
      render(<AIChat />);

      const input = screen.getByPlaceholderText(
        /Describe your automation task/
      ) as HTMLInputElement;

      fireEvent.change(input, {
        target: { value: 'Test' },
      });
      fireEvent.submit(input.closest('form')!);

      expect(input.value).toBe('');
    });

    it('should disable send button when loading', () => {
      mockUseAIAssistant.isLoading = true;

      render(<AIChat />);

      const sendButton = screen.getByRole('button', { name: /Generating/ });
      expect(sendButton).toBeDisabled();
    });

    it('should disable send button when input is empty', () => {
      render(<AIChat />);

      const sendButton = screen.getByRole('button', { name: /Send/ });
      expect(sendButton).toBeDisabled();
    });
  });

  describe('error handling', () => {
    it('should display error message', () => {
      mockUseAIAssistant.error = 'Test error message';

      render(<AIChat />);

      expect(screen.getByText('Test error message')).toBeInTheDocument();
    });

    it('should allow dismissing error', () => {
      mockUseAIAssistant.error = 'Test error';

      render(<AIChat />);

      const dismissButton = screen.getByRole('button', { name: /Dismiss/ });
      fireEvent.click(dismissButton);

      expect(mockUseAIAssistant.clearError).toHaveBeenCalled();
    });
  });

  describe('task config display', () => {
    it('should display generated task config', () => {
      mockUseAIAssistant.taskConfig = {
        contractAddress: 'CAA6NPUAA5SSJXFZB7XMZR7LNFWL7NQPL4CQIKCBGNP2IECQZ4JHVA',
        functionName: 'harvest',
        interval: 3600,
        gasBalance: 50,
      };

      render(<AIChat />);

      expect(
        screen.getByText(/Configuration Generated/)
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Configuration Generated/)
      ).toBeInTheDocument();
      expect(screen.getAllByText(/harvest/).length).toBeGreaterThan(0);
      expect(screen.getByText(/3600s/)).toBeInTheDocument();
      expect(screen.getAllByText(/50 XLM/).length).toBeGreaterThan(0);
    });

    it('should only display config fields that exist', () => {
      mockUseAIAssistant.taskConfig = {
        functionName: 'test',
        interval: 3600,
        // Missing contractAddress and gasBalance
      };

      render(<AIChat />);

      const configCard = screen.getByText(/Configuration Generated/).closest('div');
      expect(configCard?.textContent).toContain('test');
      expect(configCard?.textContent).toContain('3600');
      // Address and Gas should not appear
      expect(screen.queryByText(/Address:/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Gas:/)).not.toBeInTheDocument();
    });
  });

  describe('ABI display', () => {
    it('should display generated ABI', () => {
      const abiJson = JSON.stringify({
        functions: [{ name: 'test', inputs: [], outputs: [] }],
      });

      mockUseAIAssistant.generatedABI = abiJson;

      render(<AIChat />);

      expect(screen.getByText(/ABI Generated/)).toBeInTheDocument();
      expect(screen.getAllByText(/test/).length).toBeGreaterThan(0);
    });
  });

  describe('callbacks', () => {
    it('should call onTaskConfigGenerated when config is generated', () => {
      const onTaskConfigGenerated = jest.fn();

      const { rerender } = render(
        <AIChat onTaskConfigGenerated={onTaskConfigGenerated} />
      );

      mockUseAIAssistant.taskConfig = { functionName: 'test' };

      rerender(<AIChat onTaskConfigGenerated={onTaskConfigGenerated} />);

      expect(onTaskConfigGenerated).toHaveBeenCalledWith({
        functionName: 'test',
      });
    });

    it('should call onABIGenerated when ABI is generated', () => {
      const onABIGenerated = jest.fn();
      const abi = JSON.stringify({ functions: [] });

      const { rerender } = render(
        <AIChat onABIGenerated={onABIGenerated} />
      );

      mockUseAIAssistant.generatedABI = abi;

      rerender(<AIChat onABIGenerated={onABIGenerated} />);

      expect(onABIGenerated).toHaveBeenCalledWith(abi);
    });
  });

  describe('loading indicator', () => {
    it('should show loading indicator when loading', () => {
      mockUseAIAssistant.isLoading = true;

      render(<AIChat />);

      expect(screen.getByRole('button', { name: /Generating/ })).toBeInTheDocument();
    });
  });
});
