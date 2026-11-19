import { ErrorBoundary } from './shell/ErrorBoundary.js';
import { Shell } from './shell/Shell.js';

export function App() {
  return (
    <ErrorBoundary region="shell">
      <Shell />
    </ErrorBoundary>
  );
}
