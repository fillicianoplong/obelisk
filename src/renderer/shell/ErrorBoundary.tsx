import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  region: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[obelisk:${this.props.region}]`, error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error !== null) {
      return (
        <div className="renderer-error" role="alert" data-region="renderer-error">
          <p className="renderer-error-title">Something went wrong in the {this.props.region}.</p>
          <p className="renderer-error-detail">{this.state.error.message}</p>
        </div>
      );
    }
    return this.props.children;
  }
}