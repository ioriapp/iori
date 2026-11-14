export function extractReleaseDownloadNames(document) {
  return Array.from(
    document.matchAll(
      /https:\/\/github\.com\/ioriapp\/iori\/releases\/latest\/download\/([^/?#\s)>"']+)/g,
    ),
    ([, name]) => name,
  );
}
