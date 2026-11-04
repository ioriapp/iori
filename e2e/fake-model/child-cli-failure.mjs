const missingModel = "iori-verification-unavailable-model";
const codexError = {
  error: {
    status: 400,
    type: "invalid_request_error",
    message: `The model '${missingModel}' does not exist or you do not have access to it.`,
  },
};
const claudeError = {
  error: {
    status: 404,
    type: "not_found_error",
    message: `model: ${missingModel}`,
  },
};

export const childCliFailureScripts = {
  "failure-codex": [codexError],
  "failure-claude": [claudeError],
  "failure-handoff": [claudeError],
};
