/**
 * Error Boundary primitive.
 *
 * Class component because React still requires a class to catch
 * render-phase errors (`componentDidCatch` / `getDerivedStateFromError`
 * have no hook equivalents in React 19). Wraps the whole extension UI
 * so a crash inside any descendant surfaces as a readable fallback
 * instead of an empty white page — that scenario was happening when
 * a render-phase throw (router mismatch, hook contract violation,
 * lucide-react icon resolution failure under HMR, etc.) tore down the
 * React tree without leaving any visible breadcrumb behind.
 *
 * The fallback is intentionally minimal so it can render even if the
 * design tokens / Tailwind layer never finished loading.
 */

import {Component, type ErrorInfo, type ReactNode} from 'react'

export interface ExtensionErrorBoundaryProps {
  /** Default fallback can be overridden per-subtree. */
  fallback?: (input: {error: Error; reset: () => void}) => ReactNode
  /** Reported when an error is caught so the host can log diagnostics. */
  onError?: (error: Error, info: ErrorInfo) => void
  children: ReactNode
}

interface ExtensionErrorBoundaryState {
  error: Error | null
}

export class ExtensionErrorBoundary extends Component<
  ExtensionErrorBoundaryProps,
  ExtensionErrorBoundaryState
> {
  static displayName = 'ExtensionErrorBoundary'

  override state: ExtensionErrorBoundaryState = {error: null}

  static getDerivedStateFromError(error: Error): ExtensionErrorBoundaryState {
    return {error}
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info)
    // Surface in the bundled console so the host's stdio capture
    // forwards it as a `warn`-level entry; without this the only
    // breadcrumb would be a blank screen.

    console.error('[extension] uncaught render error', error, info)
  }

  private readonly reset = (): void => {
    this.setState({error: null})
  }

  override render(): ReactNode {
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback({error: this.state.error, reset: this.reset})
      }
      return (
        <div
          role="alert"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem',
            padding: '1.5rem',
            fontFamily:
              'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont',
            color: '#7f1d1d',
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: '0.5rem',
            margin: '1rem',
          }}
        >
          <strong style={{fontSize: '0.875rem'}}>Extension UI crashed</strong>
          <pre
            style={{
              fontSize: '0.75rem',
              lineHeight: 1.4,
              overflow: 'auto',
              maxHeight: '12rem',
              margin: 0,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {this.state.error.message}
          </pre>
          <button
            type="button"
            onClick={this.reset}
            style={{
              alignSelf: 'flex-start',
              padding: '0.375rem 0.75rem',
              fontSize: '0.75rem',
              borderRadius: '0.375rem',
              border: '1px solid #fecaca',
              backgroundColor: '#fff',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
