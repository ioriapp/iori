export function isWindowsHostPath(value: string): boolean {
  return /^[A-Za-z]:|\\/u.test(value);
}

// Host paths compare without trailing separators; Windows paths ignore case.
export function hostPathKey(value: string): string {
  const trimmed = value.replace(/[\\/]+$/u, "");
  return isWindowsHostPath(value)
    ? trimmed.replaceAll("\\", "/").toLowerCase()
    : trimmed;
}
export function samePath(left: string, right: string) {
  return hostPathKey(left) === hostPathKey(right);
}
