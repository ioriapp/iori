import { TeamEditor } from "../../apps/client/src/teams/TeamEditor.tsx";
import { TeamContext } from "../../apps/client/src/teams/context.tsx";
import { TooltipProvider } from "../../apps/client/src/components/ui/tooltip.tsx";
import { SidebarProvider } from "../../apps/client/src/components/ui/sidebar.tsx";
import { translator } from "../../apps/client/src/i18n.ts";
import { teamEditorFixture } from "./team-editor-states.ts";
import { host } from "./fixtures.ts";

const noop = () => {};
const asyncNoop = async () => {};
export function TeamEditorPreview({
  state,
  language,
}: {
  state: string;
  language: string;
}) {
  const { cliList, initial } = teamEditorFixture(state);
  return (
    <TooltipProvider>
      <SidebarProvider style={{ height: "100dvh" }}>
        <TeamContext.Provider
          value={{
            t: translator(language),
            language,
            clis: cliList,
            catalogs: {
              claude: {
                models: [
                  {
                    name: "sonnet",
                    label: "Sonnet",
                    efforts: ["low", "medium", "high"],
                  },
                ],
                permissions: [],
              },
            },
            loadingModels: {},
            cliNames: {},
            hostName: host.hostName,
          }}
        >
          <TeamEditor
            host={host.publicKey}
            active
            initial={initial}
            initialPage="teams"
            initialDrafts={{}}
            entry={0}
            allClis={cliList}
            failedDefinitions={[]}
            cliListError={false}
            onRetryClis={noop}
            registerGuard={noop}
            registerBack={noop}
            onOpenTerminal={noop}
            onClisChanged={asyncNoop}
            onAgentsOpened={noop}
            onRetryModels={noop}
            onRequestedTeamOpened={noop}
          />
        </TeamContext.Provider>
      </SidebarProvider>
    </TooltipProvider>
  );
}
