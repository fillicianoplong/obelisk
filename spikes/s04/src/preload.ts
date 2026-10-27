const proc = process as NodeJS.Process & { sandboxed?: boolean };

try {
  console.log(
    `S04_PRELOAD ${JSON.stringify({
      sandboxed: proc.sandboxed ?? null,
      contextIsolated: process.contextIsolated,
      type: process.type,
    })}`,
  );
} catch (error) {
  console.log(
    `S04_PRELOAD ${JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
    })}`,
  );
}
