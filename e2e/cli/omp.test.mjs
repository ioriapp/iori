import test from "node:test";
import { contracts } from "./contracts.mjs";
import { assertTeamPermissionArguments, withCli } from "./fixture.mjs";

contracts("omp");

test("候補の許可を選ぶと起動の引数に付く", (t) =>
  withCli(t, "omp", {}, (context) =>
    assertTeamPermissionArguments(
      context,
      "omp",
      "write",
      ["--approval-mode", "write"],
      (pty) => pty.output("COMPAT_READY"),
    ),
  ));
