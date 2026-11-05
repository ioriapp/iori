import { Button } from "../components/ui/button.tsx";
import { FirewallCommand } from "./FirewallCommand.tsx";
import type { MaintenanceStatus } from "@iori/protocol";

export type SetupNotice = {
  name: string;
  localOnly: boolean;
  lingerUser?: string;
  firewallCommand?: string;
  firewallTarget?: string;
  uninstall?: MaintenanceStatus;
};

export function HostSetupNotice({
  notice,
  t,
  onClose,
}: {
  notice: SetupNotice;
  t: (key: string) => string;
  onClose: () => void;
}) {
  return (
    <div
      className="storage-retry setup-notice"
      role="status"
      data-iori-state={
        notice.uninstall ? "uninstall-complete" : "setup-complete"
      }
    >
      <div className="flex flex-col gap-2 self-center [&>p]:m-0">
        <p>
          {t(
            notice.uninstall
              ? notice.uninstall.phase !== "succeeded"
                ? "Uninstall of {name}'s iori Host started."
                : notice.uninstall.deleteData
                  ? "{name}'s iori Host and its saved data were deleted."
                  : "{name}'s iori Host was uninstalled."
              : "Registered “{name}”.",
          ).replace("{name}", notice.name)}
        </p>
        {Boolean(notice.uninstall?.forgeTokensRemaining?.length) && (
          <div role="alert" className="flex flex-col gap-2">
            <p className="m-0">
              {t(
                "The tokens for these sites could not be deleted. Delete them manually from the OS credential store.",
              )}
            </p>
            <div>
              {notice.uninstall!.forgeTokensRemaining!.map((site) => (
                <span className="block wrap-anywhere" key={site}>
                  {site}
                </span>
              ))}
            </div>
            <p className="m-0">
              {t("A token can still be used until you revoke it on the site.")}
            </p>
          </div>
        )}
        {notice.lingerUser && (
          <p>
            {t(
              "iori Host will stop after logout. An administrator can enable it with:",
            )}{" "}
            <code>sudo loginctl enable-linger {notice.lingerUser}</code>
          </p>
        )}
        {notice.localOnly && (
          <span>
            {" "}
            {t(
              "This PC can connect. To connect from other devices, select “Allow connections from other devices” in Connection settings.",
            )}
          </span>
        )}
        {notice.firewallCommand && (
          <FirewallCommand
            command={notice.firewallCommand}
            target={notice.firewallTarget}
            t={t}
          />
        )}
      </div>
      <Button className="self-center" variant="ghost" onClick={onClose}>
        {t("Close")}
      </Button>
    </div>
  );
}
