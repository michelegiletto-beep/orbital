import { Component, type ErrorInfo, type ReactNode } from "react";
export class WorkspaceBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, _info: ErrorInfo) {
    console.error("Workspace render failure", error.name, error.message);
  }
  render() {
    return this.state.failed ? (
      <main className="workspace-recovery">
        <span className="eyebrow">ORBITAL WORKSPACE</span>
        <h1>The workspace could not be displayed</h1>
        <p>
          Your last saved flight remains on this device. Reload to restore it.
        </p>
        <button
          className="hub-button primary-action"
          onClick={() => window.location.reload()}
        >
          Reload workspace
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}
