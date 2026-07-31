import {Component, type ErrorInfo, type ReactNode} from 'react'

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class ExtensionErrorBoundary extends Component<{children: ReactNode}, ErrorBoundaryState> {
  constructor(props: {children: ReactNode}) {
    super(props)
    this.state = {hasError: false, error: null}
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {hasError: true, error}
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Extension error boundary caught:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
          <h2 className="text-base font-medium text-fg">Something went wrong</h2>
          <p className="text-sm text-muted">
            {this.state.error?.message ?? 'An unexpected error occurred.'}
          </p>
          <button
            type="button"
            onClick={() => this.setState({hasError: false, error: null})}
            className="rounded-lg bg-surface-2 px-4 py-2 text-sm font-medium text-fg transition-colors hover:bg-surface-3"
          >
            Try again
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
