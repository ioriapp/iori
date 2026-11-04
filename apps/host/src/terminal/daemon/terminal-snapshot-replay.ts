import type { TerminalSnapshot } from "@iori/protocol";
import { buildTerminalSnapshotRestoreSequence } from "@iori/protocol";
import type { HeadlessEmulator } from "./headless-emulator.ts";

export async function replayTerminalSnapshot(
  emulator: HeadlessEmulator,
  snapshot: TerminalSnapshot,
): Promise<void> {
  emulator.setRestoredOscLinks(snapshot.oscLinks);
  const sequence = buildTerminalSnapshotRestoreSequence(snapshot);
  if (!emulator.writeSync(sequence)) await emulator.write(sequence);
}
