const registeredBands = new Set<HTMLElement>();
const fallbackBands = new Set<HTMLElement>();

let resizeObserver: ResizeObserver | undefined;
let windowListening = false;
let activeConsumers = 0;

function ensureObserver(): ResizeObserver | undefined {
  if (typeof ResizeObserver === "undefined") return undefined;
  resizeObserver ??= new ResizeObserver(updateLowerBandInset);
  return resizeObserver;
}

function syncWindowListener() {
  if (typeof window === "undefined") return;
  const shouldListen = activeConsumers > 0 || registeredBands.size > 0;
  if (shouldListen && !windowListening) {
    window.addEventListener("resize", updateLowerBandInset);
    windowListening = true;
  } else if (!shouldListen && windowListening) {
    window.removeEventListener("resize", updateLowerBandInset);
    windowListening = false;
  }
}

export function updateLowerBandInset(): void {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  const seen = new Set<HTMLElement>();
  const tops: number[] = [];
  for (const element of [...registeredBands, ...fallbackBands]) {
    if (seen.has(element) || !element.isConnected) continue;
    seen.add(element);
    if (element.getClientRects().length > 0) {
      tops.push(element.getBoundingClientRect().top);
    }
  }
  const top = Math.min(window.innerHeight, ...tops);
  document.documentElement.style.setProperty(
    "--removal-lower-bands-height",
    `${Math.max(0, window.innerHeight - top)}px`,
  );
}

/**
 * Registers a bottom-anchored band element (e.g. mobile terminal controls or
 * status bar) so overlays/toasts reserve space above it via ResizeObserver.
 */
export function registerLowerBand(element: HTMLElement | null): () => void {
  if (!element) return () => {};
  registeredBands.add(element);
  ensureObserver()?.observe(element);
  syncWindowListener();
  updateLowerBandInset();
  return () => {
    registeredBands.delete(element);
    if (!fallbackBands.has(element)) {
      resizeObserver?.unobserve(element);
    }
    syncWindowListener();
    if (activeConsumers > 0 || registeredBands.size > 0) {
      updateLowerBandInset();
    } else if (typeof document !== "undefined") {
      document.documentElement.style.removeProperty(
        "--removal-lower-bands-height",
      );
    }
  };
}

/**
 * Acquires the lower-band inset measurement while NoticeStack is mounted.
 * Performs a one-time fallback lookup for existing `.status-bar` elements
 * until StatusBar registers itself directly via `registerLowerBand`.
 */
export function acquireLowerBandInset(): () => void {
  activeConsumers += 1;
  const localFallbacks: HTMLElement[] = [];
  if (typeof document !== "undefined") {
    for (const element of document.querySelectorAll<HTMLElement>(
      ".status-bar",
    )) {
      if (!fallbackBands.has(element)) {
        fallbackBands.add(element);
        localFallbacks.push(element);
        ensureObserver()?.observe(element);
      }
    }
  }
  syncWindowListener();
  updateLowerBandInset();
  return () => {
    activeConsumers = Math.max(0, activeConsumers - 1);
    for (const element of localFallbacks) {
      fallbackBands.delete(element);
      if (!registeredBands.has(element)) {
        resizeObserver?.unobserve(element);
      }
    }
    syncWindowListener();
    if (activeConsumers === 0 && registeredBands.size === 0) {
      resizeObserver?.disconnect();
      resizeObserver = undefined;
      if (typeof document !== "undefined") {
        document.documentElement.style.removeProperty(
          "--removal-lower-bands-height",
        );
      }
    } else {
      updateLowerBandInset();
    }
  };
}
