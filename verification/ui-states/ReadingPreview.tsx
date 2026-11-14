import { FilesPane } from "../../apps/client/src/files/FilesPane.tsx";
import { GitPane } from "../../apps/client/src/git/GitPane.tsx";
import { CiPane } from "../../apps/client/src/forge/CiPane.tsx";
import {
  readingRoot,
  readingPath,
  readingChoices,
  readingChange,
  readingLongBranch,
  readingTransport,
} from "./reading-fixtures.ts";

/** Product panes with display data only; no Host or native calls. */
export function ReadingPreview({ state }: { state: string }) {
  const number = Number(state.split("-")[1]);
  const kind =
    state.includes("-ci") || [5, 6].includes(number)
      ? "ci"
      : state.includes("-git") || number === 4
        ? "git"
        : "files";
  const detailOpen = state.endsWith("-detail") || number === 9;
  const common = {
    hostKey: "ui-state-host",
    root: readingRoot,
    label: number === 6 ? readingLongBranch : readingChoices[1].label,
    worktrees:
      number === 6
        ? readingChoices.map((choice, index) =>
            index === 1 ? { ...choice, label: readingLongBranch } : choice,
          )
        : readingChoices,
    locale: "ja",
  };
  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
      {kind === "ci" ? (
        <CiPane
          {...common}
          viewState={{
            detailOpen,
            listOpen: true,
            selected: { kind: "job", id: "build-client" },
          }}
        />
      ) : kind === "git" ? (
        <GitPane
          {...common}
          transport={readingTransport}
          viewState={{
            detailOpen,
            listOpen: true,
            mode: "changes",
            change: readingChange,
          }}
        />
      ) : (
        <FilesPane
          {...common}
          transport={readingTransport}
          positions={{ load: async () => null, save: async () => {} }}
          viewState={{
            tabs: [readingPath],
            active: readingPath,
            detailOpen,
            listOpen: true,
            expanded: [
              "apps",
              "apps/client",
              "apps/client/src",
              "apps/client/src/reading",
              "apps/client/src/forge",
            ],
          }}
        />
      )}
    </div>
  );
}
