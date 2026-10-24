// Commands publish into React while DevTools is still inside the call.
// flushSync there updates the status bar without waiting for a paint.
// A background window may not paint, and a paint is not required to edit.

let syncDepth = 0;

export function editorUpdatesAreSynchronous(): boolean {
  return syncDepth > 0;
}

export function runWithSynchronousEditorUpdate(action: () => void): void {
  syncDepth += 1;
  try {
    action();
  } finally {
    syncDepth -= 1;
  }
}
