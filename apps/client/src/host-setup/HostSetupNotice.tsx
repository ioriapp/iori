import { Button } from "../components/ui/button.tsx";
import { FirewallCommand } from "./FirewallCommand.tsx";

export type SetupNotice = {
  name: string;
  localOnly: boolean;
  lingerUser?: string;
  firewallCommand?: string;
  firewallTarget?: string;
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
      data-iori-state="setup-complete"
    >
      <div>
        {t("Registered “{name}”").replace("{name}", notice.name)}
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
              "You can use this PC. Other devices cannot connect yet. Allow connections in Settings → Connection.",
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
      <Button variant="ghost" onClick={onClose}>
        {t("Close")}
      </Button>
    </div>
  );
}
