import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Check } from "lucide-react";
import { inviteToText, type Device, type Invite } from "@iori/protocol";
import { connection } from "../connection.ts";
import { registeredDateMessage, registeredMessage } from "../i18n.ts";
import { InviteQr } from "../InviteQr.tsx";
import {
  FieldRow,
  SettingsSection as Section,
} from "../components/page-layout.tsx";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.tsx";
import { Textarea } from "../components/ui/textarea.tsx";
import { ErrorMessage, type Translate } from "./shared.tsx";

function RevokeDialog({
  device,
  onClose,
  onRevoke,
  t,
}: {
  device?: Device;
  onClose: () => void;
  onRevoke: () => Promise<boolean>;
  t: Translate;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={Boolean(device)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="w-[min(27.5rem,calc(100vw-2rem))] max-w-[min(27.5rem,calc(100vw-2rem))]"
        data-iori-view="revoke-confirmation"
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle>{t("Revoke registration")}</DialogTitle>
          <DialogDescription>{device?.name}</DialogDescription>
        </DialogHeader>
        <p className="m-0 text-sm leading-relaxed text-muted-foreground">
          {t(
            "This device will no longer connect to this Host. Files and work on the Host, and data on this device, are not deleted.",
          )}
        </p>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{t("Cancel")}</Button>
          </DialogClose>
          <Button
            variant="destructive"
            data-iori-action="confirm-revoke"
            pending={busy}
            onClick={() => {
              setBusy(true);
              void onRevoke().finally(() => {
                setBusy(false);
                onClose();
              });
            }}
          >
            {t("Revoke registration")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Invitation({
  invite,
  status,
  device,
  busy,
  pending,
  onRevoke,
  onNewInvite,
  onNestedBack,
  t,
  language,
}: {
  invite: Invite;
  status?: "expired" | "invalidated";
  device?: Device;
  busy: boolean;
  pending: boolean;
  onRevoke: (device: Device) => void;
  onNewInvite: () => void;
  onNestedBack: (close?: () => void) => void;
  t: Translate;
  language: string;
}) {
  const [copy, setCopy] = useState(false);
  const [error, setError] = useState<string>();
  const value = inviteToText(invite);
  return (
    <section
      className="grid justify-items-start gap-2.5"
      data-iori-view="invitation"
    >
      {device ? (
        <>
          <p
            className="m-0 flex items-center gap-2 text-sm text-foreground"
            data-iori-state="device-registered"
          >
            <Check
              className="size-4 shrink-0 text-status-running-text"
              aria-hidden="true"
            />
            {registeredMessage(language, device.name)}
          </p>
          <Button
            onClick={() => onRevoke(device)}
            data-iori-action="undo-registration"
          >
            {t("Revoke")}
          </Button>
        </>
      ) : status ? (
        <>
          <p className="m-0 text-sm text-foreground">
            {t(
              status === "expired"
                ? "This invitation has expired."
                : "This invitation was invalidated by a newer invitation.",
            )}
          </p>
          <Button
            data-iori-action="new-invitation"
            disabled={busy}
            pending={pending}
            onClick={onNewInvite}
          >
            {t("Create a new invitation")}
          </Button>
        </>
      ) : (
        <>
          <p className="m-0 text-sm text-foreground">
            {t("Valid for 10 minutes. Can be used once.")}
          </p>
          <p className="m-0 text-xs leading-relaxed text-muted-foreground">
            {t("Creating a new invitation invalidates the previous one.")}
          </p>
          <InviteQr invite={invite} t={t} onNestedBack={onNestedBack} />
          <label className="grid w-full min-w-0 gap-1.5 text-sm font-medium text-foreground">
            <span>{t("Invitation")}</span>
            <Textarea
              readOnly
              value={value}
              rows={3}
              className="font-mono [font-variant-ligatures:none]"
              data-iori-field="issued-invitation"
            />
          </label>
          <Button
            variant="outline"
            data-iori-action="copy-invitation"
            onClick={() => {
              void navigator.clipboard
                .writeText(value)
                .then(() => {
                  setCopy(true);
                  setError(undefined);
                })
                .catch(() =>
                  setError(
                    t("Could not copy. Select and copy the invitation below."),
                  ),
                );
            }}
          >
            {t(copy ? "Copied" : "Copy invitation")}
          </Button>
          <ErrorMessage message={error} />
        </>
      )}
    </section>
  );
}

function seenDeviceKey(device: Device) {
  return `${device.publicKey}:${device.registeredAt}`;
}

function readSeen(hostKey: string): string[] {
  try {
    return JSON.parse(
      localStorage.getItem(`iori-devices-seen-${hostKey}`) ?? "[]",
    ) as string[];
  } catch {
    return [];
  }
}

function saveSeen(hostKey: string, devices: Device[]) {
  try {
    localStorage.setItem(
      `iori-devices-seen-${hostKey}`,
      JSON.stringify(devices.map(seenDeviceKey)),
    );
  } catch {
    // Keep the new-device mark for this session when local storage is unavailable.
  }
}

export function DevicesSettings({
  t,
  language,
  onNestedBack,
}: {
  t: Translate;
  language: string;
  onNestedBack: (close?: () => void) => void;
}) {
  const state = useSyncExternalStore(
    connection.subscribe,
    connection.getSnapshot,
  );
  const hostKey = state.host?.publicKey ?? "";
  const [busy, setBusy] = useState<"invite" | "new-invitation">();
  const [revoke, setRevoke] = useState<Device>();
  const [seen, setSeen] = useState(() => new Set(readSeen(hostKey)));
  const [revokeErrors, setRevokeErrors] = useState<Set<string>>(
    () => new Set(),
  );
  const displayStarted = useRef(false);

  useEffect(() => {
    onNestedBack(revoke ? () => setRevoke(undefined) : undefined);
    return () => onNestedBack(undefined);
  }, [onNestedBack, revoke]);

  useLayoutEffect(() => {
    if (displayStarted.current || !hostKey) return;
    const justRegistered = state.registrationReadHostKey === hostKey;
    if (justRegistered && !state.connected) return;
    if (!justRegistered && !state.connected && state.devices.length === 0)
      return;

    if (justRegistered) {
      const visible = new Set(seen);
      for (const device of state.devices) visible.add(seenDeviceKey(device));
      setSeen(visible);
      connection.markRegistrationDevicesRead(hostKey);
    }
    saveSeen(hostKey, state.devices);
    displayStarted.current = true;
  }, [
    hostKey,
    state.connected,
    state.devices,
    state.registrationReadHostKey,
    seen,
  ]);

  return (
    <Section data-iori-view="devices">
      {state.host?.connectionScope === "loopback" ? (
        <p className="m-0 text-xs leading-relaxed text-muted-foreground">
          {t(
            "This PC can connect. To connect from other devices, select “Allow connections from other devices” in Connection settings.",
          )}
        </p>
      ) : (
        <FieldRow label={t("Invite a new device")}>
          <Button
            data-iori-action="invite"
            disabled={Boolean(busy)}
            pending={busy === "invite"}
            onClick={() => {
              setBusy("invite");
              void connection.createInvite().finally(() => setBusy(undefined));
            }}
          >
            {t("Invite a new device")}
          </Button>
        </FieldRow>
      )}
      {state.error && <ErrorMessage message={t(state.error)} />}
      <div className="section-rows" role="list" data-iori-list="devices">
        {state.devices.map((device) => (
          <FieldRow
            key={device.publicKey}
            role="listitem"
            data-iori-row="device"
          >
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className="truncate text-sm font-medium text-foreground"
                  data-iori-value="device-name"
                >
                  {device.name}
                </span>
                {device.publicKey === state.initial?.publicKey ? (
                  <Badge variant="outline" data-iori-state="this-device">
                    {t("This device")}
                  </Badge>
                ) : !seen.has(seenDeviceKey(device)) ? (
                  <Badge variant="secondary" data-iori-state="new-device">
                    {t("New")}
                  </Badge>
                ) : null}
              </div>
              <p
                className="mt-0.5 mb-0 text-xs text-muted-foreground"
                data-iori-value="device-registered-date"
              >
                {registeredDateMessage(language, device.registeredAt)}
              </p>
            </div>
            <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
              {revokeErrors.has(device.publicKey) && (
                <ErrorMessage
                  message={t("Could not revoke this registration. Retry.")}
                />
              )}
              <Button
                variant="outline"
                size="sm"
                data-iori-action="revoke-device"
                onClick={() => setRevoke(device)}
              >
                {t("Revoke registration")}
              </Button>
            </div>
          </FieldRow>
        ))}
      </div>
      {state.host?.connectionScope !== "loopback" && state.invitation && (
        <Invitation
          invite={state.invitation}
          status={state.invitationStatus}
          device={state.invitedDevice}
          busy={Boolean(busy)}
          pending={busy === "new-invitation"}
          onRevoke={setRevoke}
          onNestedBack={onNestedBack}
          onNewInvite={() => {
            setBusy("new-invitation");
            void connection.createInvite().finally(() => setBusy(undefined));
          }}
          t={t}
          language={language}
        />
      )}
      <RevokeDialog
        device={revoke}
        t={t}
        onClose={() => setRevoke(undefined)}
        onRevoke={async () => {
          if (!revoke) return false;
          const ok = await connection.revoke(revoke.publicKey);
          setRevokeErrors((current) => {
            const next = new Set(current);
            if (ok) next.delete(revoke.publicKey);
            else next.add(revoke.publicKey);
            return next;
          });
          return ok;
        }}
      />
    </Section>
  );
}
