import type { SaveState } from './model.js';

interface SaveStateIconProps {
  state: SaveState;
}

const iconProps = {
  className: 'status-save-icon',
  viewBox: '0 0 16 16',
  width: 16,
  height: 16,
  fill: 'none',
  'aria-hidden': true as const,
};

// Each state has its own shape. Color only rides along with the shape.
export function SaveStateIcon({ state }: SaveStateIconProps) {
  if (state === 'saved') {
    return (
      <svg {...iconProps} data-save-icon="saved">
        <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.25" />
        <path
          d="M5.15 8.2 L7.1 10.15 L10.9 6.05"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (state === 'saving') {
    return (
      <svg {...iconProps} data-save-icon="saving">
        <path
          d="M8 3.15 a4.85 4.85 0 1 1 -3.55 1.45"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
        />
        <path
          d="M4.15 2.4 V5.15 H6.9"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (state === 'unsaved') {
    return (
      <svg {...iconProps} data-save-icon="unsaved">
        <circle cx="8" cy="8" r="3.15" fill="currentColor" />
      </svg>
    );
  }
  if (state === 'not-saved') {
    return (
      <svg {...iconProps} data-save-icon="not-saved">
        <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.25" />
        <path
          d="M4.35 11.65 L11.65 4.35"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  return (
    <svg {...iconProps} data-save-icon="autosave-paused">
      <path
        d="M8 2.45 L13.85 13.15 H2.15 Z"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
      <path
        d="M8 6.35 V9.15"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
      <circle cx="8" cy="11.2" r="0.7" fill="currentColor" />
    </svg>
  );
}
