import { useEffect, useRef, useState } from 'react';
import { saveStateAnnouncement } from './model.js';

interface LiveRegionProps {
  label: string;
}

// Polite and atomic, and not focusable. Count text never goes through here,
// so a keystroke does not announce the word or character count.
export function LiveRegion({ label }: LiveRegionProps) {
  const previous = useRef<string | null>(null);
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    const next = saveStateAnnouncement(previous.current, label);
    previous.current = label;
    if (next !== null) {
      setAnnouncement(next);
    }
  }, [label]);

  return (
    <div className="status-live" role="status" aria-live="polite" aria-atomic="true">
      {announcement}
    </div>
  );
}
