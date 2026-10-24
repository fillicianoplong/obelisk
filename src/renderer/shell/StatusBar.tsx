interface StatusBarProps {
  label: string;
}

export function StatusBar({ label }: StatusBarProps) {
  return (
    <footer className="status-bar" data-region="status-bar" aria-label="Status bar">
      {label}
    </footer>
  );
}
