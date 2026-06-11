import { Component, type ErrorInfo, type ReactNode } from 'react';

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  error: Error | null;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Knowstellation render error', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="min-h-screen bg-slate-950 p-6 text-white">
        <div className="mx-auto mt-20 max-w-2xl rounded-2xl border border-red-300/30 bg-red-950/40 p-5 shadow-2xl backdrop-blur">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-red-200">Render error</p>
          <h1 className="mt-3 text-2xl font-semibold">The graph view crashed while rendering.</h1>
          <pre className="mt-4 max-h-[45vh] overflow-auto rounded-xl bg-black/35 p-4 text-xs leading-5 text-red-50">{this.state.error.message}</pre>
          <button type="button" className="mt-4 rounded-xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold text-white" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      </div>
    );
  }
}
