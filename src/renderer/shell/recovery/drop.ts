export async function dropRecoveryCopy(recoveryId: string): Promise<void> {
  try {
    await window.obelisk['recovery:drop']({ recoveryId });
  } catch {
    // Best effort. A leftover copy is offered again on the next launch.
  }
}