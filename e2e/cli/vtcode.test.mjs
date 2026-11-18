import test from "node:test";
import { launch, withCli } from "./fixture.mjs";

test("起動して最初の入力を受け付ける", (t) =>
  withCli(t, "vtcode", {}, async (context) => {
    await context.client.request("cli.arguments.set", {
      cliId: "vtcode",
      arguments: "--skip-confirmations",
    });
    await launch(context, "vtcode");
  }));
