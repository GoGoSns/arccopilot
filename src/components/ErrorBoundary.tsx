import React from 'react'
import { Button } from '@/components/ui/Button'

type ErrorBoundaryProps = {
  children: React.ReactNode
}

type ErrorBoundaryState = {
  hasError: boolean
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    console.error('[ErrorBoundary] Caught popup crash:', error, info)
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full min-h-[420px] items-center justify-center bg-arc-bg px-4 py-6">
          <div className="w-full max-w-sm rounded-2xl border border-arc-accent/25 bg-arc-card p-5 text-center shadow-2xl shadow-black/30">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-arc-accent/25 bg-arc-accent/10 text-arc-accent">
              <span className="text-lg font-bold">!</span>
            </div>
            <h1 className="text-base font-semibold text-arc-text">Bir şeyler ters gitti.</h1>
            <p className="mt-2 text-sm leading-relaxed text-arc-text-dim">
              Yenilemeyi dene. Popup tekrar açıldığında normal akış geri gelecektir.
            </p>
            <div className="mt-4">
              <Button variant="primary" className="w-full" onClick={this.handleReload}>
                Reload
              </Button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
