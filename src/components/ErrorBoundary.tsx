import { Component, type ErrorInfo, type ReactNode } from 'react'

/** Shows a friendly screen instead of a blank page if anything crashes while rendering. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('App crashed', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
        <img src="/jec-logo.png" alt="" className="h-14 w-auto" />
        <h1 className="text-2xl font-bold">Something went wrong</h1>
        <p className="text-muted">Please reload the page. If it keeps happening, tell the organisers. Your registration and payment details are safe.</p>
        <div className="flex gap-3">
          <button type="button" className="min-h-11 rounded-full bg-primary px-6 font-semibold text-on-primary" onClick={() => window.location.reload()}>
            Reload
          </button>
          <a href="/" className="inline-flex min-h-11 items-center rounded-full border border-border px-6 font-semibold text-primary">
            Go home
          </a>
        </div>
      </div>
    )
  }
}
