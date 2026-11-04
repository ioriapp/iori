/** Active upload files are Host implementation details, not workspace entries.
 * Track exact paths rather than hiding a filename pattern the user may own. */
export const fileUploadTemporaries = new Set<string>();
