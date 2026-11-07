import type { ReactNode } from "react";
import { Input } from "../components/ui/input.tsx";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "../components/ui/toggle-group.tsx";

export function SetupFields({
  name,
  remote,
  disabled,
  t,
  onName,
  onRemote,
  children,
}: {
  name: string;
  remote: boolean;
  disabled?: boolean;
  t: (key: string) => string;
  onName: (name: string) => void;
  onRemote: (remote: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <div className="ssh-setup-fields">
      <label className="ssh-setup-field">
        <span className="field-label">{t("This device’s name")}</span>
        <Input
          value={name}
          disabled={disabled}
          aria-invalid={!name.trim() || undefined}
          onChange={(event) => onName(event.target.value)}
          data-iori-field="device-name"
        />
        <span className="ssh-setup-help">
          {t("This name appears in the iori Host device list.")}
        </span>
      </label>
      <div className="ssh-setup-field">
        <span className="field-label">{t("Destination")}</span>
        <ToggleGroup
          type="single"
          variant="outline"
          value={remote ? "ssh" : "local"}
          onValueChange={(value) => {
            if (value) onRemote(value === "ssh");
          }}
          disabled={disabled}
          className="justify-start"
        >
          <ToggleGroupItem value="local" data-iori-action="setup-local">
            {t("This PC")}
          </ToggleGroupItem>
          <ToggleGroupItem value="ssh" data-iori-action="setup-ssh">
            {t("Another machine (SSH)")}
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      {children}
    </div>
  );
}
