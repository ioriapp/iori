// Programmatic focus inherits the previous keyboard focus in some browsers.
// Track the gesture so opening a popup by pointer does not show a focus ring.
document.addEventListener("pointerdown", () => {
  document.documentElement.dataset.inputModality = "pointer"
}, true)
document.addEventListener("keydown", () => {
  document.documentElement.dataset.inputModality = "keyboard"
}, true)
