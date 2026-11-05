import { useState } from "react";
import { native } from "../native.ts";
import { Button } from "../components/ui/button.tsx";

export function FirewallCommand({
  command,
  t,
}: {
  command: string;
  t: (key: string) => string;
}) {
  const [copied, setCopied] = useState<string>();
  const [error, setError] = useState<string>();
  return (
    <div
      className="settings-note setup-firewall-guidance"
      data-iori-state="setup-firewall-command"
    >
      <p>
        {t(
          "Other devices cannot connect yet. An administrator on that PC can allow it with this command:",
        )}
      </p>
      <div className="setup-command">
        <code data-iori-field="setup-command">{command}</code>
        <Button
          type="button"
          variant="outline"
          data-iori-action="copy-setup-command"
          onClick={() => {
            void native.clipboardWrite(command).then(
              () => {
                setCopied(command);
                setError(undefined);
              },
              () => setError(t("Could not copy. Select the text and copy it.")),
            );
          }}
        >
          {t(copied === command ? "Copied" : "Copy command")}
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
