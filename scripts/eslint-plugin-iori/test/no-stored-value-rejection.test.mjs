import { ruleTester } from "./rule-tester.mjs";
import rule from "../rules/no-stored-value-rejection.mjs";

ruleTester.run("no-stored-value-rejection", rule, {
  valid: [
    {
      code: "if (msg.participantId !== session.participantId) throw new Error('forbidden');",
    },
    {
      code: "if (draft.title !== saved.title) throw new Error('mismatch');",
    },
    {
      code: "function areEqual(prev, next) { if (prev.revision !== next.revision) return false; return true; }",
    },
    {
      code: "if (requestOffset < 0) throw new Error('invalid input');",
    },
    {
      code: "if (cachedRevision === requestedRevision) return true;",
    },
    {
      code: "if (cachedHash !== requestedHash) logMismatch();",
    },
    {
      code: "if (storedOffset === receivedOffset) return { ok: false };",
    },
  ],
  invalid: [
    {
      code: "if (cachedRevision !== requestedRevision) throw new Error('mismatch');",
      errors: [{ messageId: "storedValueMismatch" }],
    },
    {
      code: "if (storedOffset !== receivedOffset) return { ok: false };",
      errors: [{ messageId: "storedValueMismatch" }],
    },
    {
      code: "function read() { return storedHash !== expectedHash ? { ok: false } : storedHash; }",
      errors: [{ messageId: "storedValueMismatch" }],
    },
    {
      code: "if (a.revision !== b.revision) return { error: 'stale' };",
      errors: [{ messageId: "storedValueMismatch" }],
    },
    {
      code: "if (stat.size !== expectedSize) throw new Error('mismatch');",
      errors: [{ messageId: "storedValueMismatch" }],
    },
    {
      code: "if (local.version !== remote.version) throw new Error('mismatch');",
      errors: [{ messageId: "storedValueMismatch" }],
    },
    {
      code: "function read() { if (cachedRevision !== requestedRevision) return Promise.reject(new Error('mismatch')); }",
      errors: [{ messageId: "storedValueMismatch" }],
    },
    {
      code: "if (cachedRevision !== requestedRevision) return { status: 'failed' };",
      errors: [{ messageId: "storedValueMismatch" }],
    },
    {
      code: "assert(cachedHash === sentHash);",
      errors: [{ messageId: "storedValueMismatch" }],
    },
  ],
});
