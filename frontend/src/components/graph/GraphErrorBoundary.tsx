"use client";

import { Component, type ReactNode } from "react";

interface GraphErrorBoundaryProps {
  children: ReactNode;
}

interface GraphErrorBoundaryState {
  hasError: boolean;
}

export class GraphErrorBoundary extends Component<
  GraphErrorBoundaryProps,
  GraphErrorBoundaryState
> {
  constructor(props: GraphErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
    this.handleRetry = this.handleRetry.bind(this);
  }

  static getDerivedStateFromError(): GraphErrorBoundaryState {
    return { hasError: true };
  }

  handleRetry() {
    this.setState({ hasError: false });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          data-testid="graph-error-boundary"
          className="flex flex-col items-center justify-center gap-3 rounded-xl border border-neutral-700/50 bg-neutral-900 py-16 text-center text-neutral-300"
        >
          <p>Graph failed to load. Try refreshing the page.</p>
          <button
            type="button"
            onClick={this.handleRetry}
            className="rounded-lg bg-blue-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default GraphErrorBoundary;
