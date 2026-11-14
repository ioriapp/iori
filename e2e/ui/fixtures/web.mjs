import { createWebServer } from "../../../verification/web/dev.mjs";

// Only compiled assets are shared. Every test still owns its bridge, keys,
// saved Client state, real Host and browser context.
const vite = await createWebServer(
  0,
  'new URLSearchParams(window.location.search).get("iori-bridge")',
);
await vite.listen();
process.send(`http://127.0.0.1:${vite.httpServer.address().port}`);
await new Promise((resolve) => {
  process.once("message", resolve);
  process.once("disconnect", resolve);
});
await vite.close();
process.disconnect();
