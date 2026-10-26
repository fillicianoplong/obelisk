// Frame colors. They mirror tokens.css, and the unit test fails if they drift.
// Light is the default. Dark is used when Windows is in dark mode.

export const SHELL_FRAME = {
  titleBarHeight: 32,
  light: {
    titleBar: '#E6EAF0',
    symbol: '#1F2630',
    window: '#EDF0F4',
  },
  dark: {
    titleBar: '#20252C',
    symbol: '#E6EAF0',
    window: '#16191E',
  },
} as const;

export interface ShellFrameColors {
  backgroundColor: string;
  overlayColor: string;
  symbolColor: string;
  titleBarHeight: number;
}

export function shellFrameColors(useDarkColors: boolean): ShellFrameColors {
  const theme = useDarkColors ? SHELL_FRAME.dark : SHELL_FRAME.light;
  return {
    // Same color as the title bar. The window background shows through as a
    // one-pixel line along the top, so a canvas color leaves that line visible.
    backgroundColor: theme.titleBar,
    overlayColor: theme.titleBar,
    symbolColor: theme.symbol,
    titleBarHeight: SHELL_FRAME.titleBarHeight,
  };
}

export interface ContrastFrameColors {
  background: string;
  symbol: string;
}

export function contrastFrameColors(colors: ContrastFrameColors): ShellFrameColors {
  return {
    backgroundColor: colors.background,
    overlayColor: colors.background,
    symbolColor: colors.symbol,
    titleBarHeight: SHELL_FRAME.titleBarHeight,
  };
}

// A contrast theme wins over Light, Dark, and Match Windows. Without a system
// color to copy, the Slate frame is the fallback so the window still opens.
export function frameColorsFor(options: {
  highContrast: boolean;
  dark: boolean;
  contrast: ContrastFrameColors | null;
}): ShellFrameColors {
  if (options.highContrast && options.contrast !== null) {
    return contrastFrameColors(options.contrast);
  }
  return shellFrameColors(options.dark);
}
