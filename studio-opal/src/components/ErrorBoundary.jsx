import { Component } from 'react';

// Keeps one broken screen from taking down the whole app: shows what went wrong and a way back.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error) {
    // eslint-disable-next-line no-console
    console.error('Studio screen error:', error);
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, () => this.setState({ error: null }));
    return (
      <div className='crash'>
        <div className='crash-card'>
          <div className='crash-icon' aria-hidden='true'>!</div>
          <h2>This screen hit a problem</h2>
          <p className='hint'>{String(error?.message || error)}</p>
          <div className='inline'>
            <button className='btn primary' onClick={() => this.setState({ error: null })}>Try again</button>
            <button className='btn' onClick={() => location.reload()}>Reload Studio</button>
          </div>
        </div>
      </div>
    );
  }
}
