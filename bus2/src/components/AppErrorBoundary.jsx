import { Component } from 'react';

export default class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    console.error('AdKerala render error:', error);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="app-error-fallback">
        <h1>Something went wrong</h1>
        <p>The app hit an error loading your saved data. Your route files in <code>db/info.txt</code> are usually fine — browser storage may be out of sync.</p>
        <pre>{error?.message ?? String(error)}</pre>
        <div className="app-error-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => {
              try {
                localStorage.removeItem('kerala-bus-state');
              } catch {
                /* ignore */
              }
              window.location.href = '/';
            }}
          >
            Reset browser cache &amp; reload
          </button>
        </div>
      </div>
    );
  }
}
