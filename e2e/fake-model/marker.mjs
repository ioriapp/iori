let realModels = false;

export function setRealModels(value) {
  realModels = value;
}

export function fakeMarker(name) {
  return realModels ? "" : ` [fake-model:${name}]`;
}
