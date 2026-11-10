let realModels = false;
let excludedPrefixes = [];

export function setRealModels(value) {
  realModels = value;
}

export function setFakeMarkerExcludedPrefixes(value) {
  excludedPrefixes = value;
}

export function fakeMarker(name) {
  return realModels ||
    excludedPrefixes.some((prefix) => name.startsWith(prefix))
    ? ""
    : ` [fake-model:${name}]`;
}
