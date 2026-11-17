import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

export const prompt = "Add a dark mode toggle to settings. Have it reviewed.";
export const instruction = `Work in English. Keep progress messages concise.
Use iori plan to record a short plan before delegating implementation to Worker.
Use the parent worktree for this small change. The app uses Vite and React; settings are in src/App.jsx and styles are in src/style.css.
Use three short plan items: implement, review, and accept. Link each delegation to its plan item and update progress as the work completes.
Only after Worker reports, ask Reviewer to review the actual change. Do not start Reviewer alongside Worker.
Worker should leave the changes uncommitted so the user can inspect the diff. After Reviewer reports, read the actual changes, accept both agents with iori finish if the result is sound, and complete the plan. Leave the diff uncommitted.
Do not implement the change yourself. Do not publish, push, or use external services.`;

export async function createSample(folder) {
  await mkdir(join(folder, "src"), { recursive: true });
  const files = {
    "package.json":
      JSON.stringify(
        {
          name: "acme-web",
          private: true,
          type: "module",
          scripts: { dev: "vite", build: "vite build" },
          dependencies: {
            react: "19.2.8",
            "react-dom": "19.2.8",
            vite: "8.3.0",
          },
        },
        null,
        2,
      ) + "\n",
    "index.html":
      '<!doctype html><html lang="en"><head><meta charset="UTF-8"><title>acme-web</title></head><body><div id="root"></div><script type="module" src="/src/App.jsx"></script></body></html>\n',
    "src/App.jsx": `import React from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

function Settings() {
  return <main><h1>Settings</h1><section><h2>Appearance</h2><p>Choose how your workspace looks.</p></section></main>;
}
createRoot(document.getElementById("root")).render(<Settings />);
`,
    "src/style.css": `:root { font-family: system-ui, sans-serif; color-scheme: light; }
body { margin: 0; }
main { max-width: 44rem; margin: 4rem auto; padding: 2rem; }
section { border: 1px solid; border-radius: .5rem; padding: 1.5rem; }
`,
    "AGENTS.md":
      "Use concise English. Implement only the requested settings change. Keep the app accessible and respect the current structure. Do not delegate additional agents.\n",
    ".gitignore": "node_modules/\ndist/\n",
  };
  for (const [name, contents] of Object.entries(files))
    await writeFile(join(folder, name), contents);
  // Prepare dependencies before the live model run so implementation and review
  // can use the sample's actual production build without an install interruption.
  execFileSync("npm", ["install", "--no-audit", "--no-fund"], {
    cwd: folder,
    stdio: "pipe",
  });
  execFileSync("git", ["init", "-q", folder]);
  execFileSync("git", ["-C", folder, "config", "user.name", "Demo"]);
  execFileSync("git", [
    "-C",
    folder,
    "config",
    "user.email",
    "demo@example.com",
  ]);
  execFileSync("git", ["-C", folder, "add", "."]);
  execFileSync("git", [
    "-C",
    folder,
    "commit",
    "-qm",
    "Create settings sample",
  ]);
}
