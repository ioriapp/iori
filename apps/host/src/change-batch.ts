/** Gather filesystem bursts before starting expensive reads. Unlike a trailing
 * debounce, continuous writes still publish a batch every 100 ms plus read time.
 * This is shorter than VS Code Git's 1 s debounce to keep live views responsive. */
export function batchChanges(read: () => Promise<void>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let dirty = false;
  let closed = false;
  const schedule = () => {
    if (closed || running || timer || !dirty) return;
    timer = setTimeout(() => {
      timer = undefined;
      dirty = false;
      running = true;
      void read()
        .catch(() => undefined)
        .finally(() => {
          running = false;
          schedule();
        });
    }, 100);
    timer.unref();
  };
  return {
    changed() {
      dirty = true;
      schedule();
    },
    close() {
      closed = true;
      clearTimeout(timer);
    },
  };
}
