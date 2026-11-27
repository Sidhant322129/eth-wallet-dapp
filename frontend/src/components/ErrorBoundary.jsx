import { Component } from "react";

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.error("Application render error:", error?.message || "Unexpected UI error");
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="dashboard" role="alert">
          <h1>Something went wrong</h1>
          <p>An unexpected UI error occurred. Your wallet funds and on-chain state are unaffected.</p>
          <button onClick={() => window.location.reload()}>Reload Application</button>
        </main>
      );
    }

    return this.props.children;
  }
}
