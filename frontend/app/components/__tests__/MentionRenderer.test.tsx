import React from 'react';
import { render, screen } from '@testing-library/react';
import { MentionRenderer } from '../components/MentionRenderer';

describe('MentionRenderer', () => {
  it('renders plain text without mentions', () => {
    render(<MentionRenderer text="This is plain text" />);
    expect(screen.getByText('This is plain text')).toBeInTheDocument();
  });

  it('renders user mentions with avatar', () => {
    render(<MentionRenderer text="Hello @Alice Johnson" />);
    expect(screen.getByText('@Alice Johnson')).toBeInTheDocument();
    expect(screen.getByText('AJ')).toBeInTheDocument();
  });

  it('renders task mentions', () => {
    render(<MentionRenderer text="Working on #Harvest Task" />);
    expect(screen.getByText('#Harvest Task')).toBeInTheDocument();
    expect(screen.getByText('📋')).toBeInTheDocument();
  });

  it('renders contract mentions', () => {
    render(<MentionRenderer text="Check $Yield Contract" />);
    expect(screen.getByText('$Yield Contract')).toBeInTheDocument();
    expect(screen.getByText('📄')).toBeInTheDocument();
  });

  it('renders mixed text with mentions', () => {
    render(<MentionRenderer text="Hey @Alice, check #Task and $Contract" />);
    expect(screen.getByText('Hey ')).toBeInTheDocument();
    expect(screen.getByText('@Alice')).toBeInTheDocument();
    expect(screen.getByText(', check ')).toBeInTheDocument();
    expect(screen.getByText('#Task')).toBeInTheDocument();
    expect(screen.getByText(' and ')).toBeInTheDocument();
    expect(screen.getByText('$Contract')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    render(<MentionRenderer text="Test" className="custom-class" />);
    const container = screen.getByText('Test').parentElement;
    expect(container).toHaveClass('custom-class');
  });

  it('handles empty text', () => {
    const { container } = render(<MentionRenderer text="" />);
    expect(container.firstChild).toBeNull();
  });
});