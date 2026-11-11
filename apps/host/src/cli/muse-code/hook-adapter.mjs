// Background threads run the same hooks but must not update the main session.
export function preparePayload() {
  const { MUSE_SESSION_ID: session, MUSE_THREAD_ID: thread } = process.env;
  if (session && thread && session !== thread) return false;
}
