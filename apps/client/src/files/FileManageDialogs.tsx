import { useEffect, useRef, useState } from "react";
import { translator } from "../i18n.ts";
import { ReadError } from "../reading/transport.ts";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";

export function fileManageErrorCopy(error: unknown, locale: string): string {
  const t = translator(locale);
  if (!(error instanceof ReadError)) {
    return t("Could not complete this operation.");
  }
  const copy: Record<string, string> = {
    put_exists: "An item with this name already exists.",
    path_outside_root: "This path is outside the open folder.",
    path_not_found: "This file was deleted or moved.",
    not_a_directory: "This path is not a folder.",
    permission_denied: "You do not have permission to write to this folder.",
    invalid_request: "Enter a valid name.",
  };
  return t(copy[error.code] ?? "Could not complete this operation.");
}

export type FileCreateDialogProps = {
  open: boolean;
  kind: "file" | "directory";
  parentFolder: string;
  locale: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (relativePath: string) => Promise<string | undefined>;
};

export function FileCreateDialog({
  open,
  kind,
  parentFolder,
  locale,
  onOpenChange,
  onSubmit,
}: FileCreateDialogProps) {
  const t = translator(locale);
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setError(undefined);
      setPending(false);
    }
  }, [open, kind, parentFolder]);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || pending) return;
    const relativePath = parentFolder ? `${parentFolder}/${trimmed}` : trimmed;
    setPending(true);
    setError(undefined);
    try {
      const message = await onSubmit(relativePath);
      if (message) setError(message);
      else onOpenChange(false);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) onOpenChange(false);
      }}
    >
      <DialogContent
        data-iori-dialog="file-create"
        className="max-md:top-auto max-md:bottom-3 max-md:w-[calc(100%-1.5rem)] max-md:max-w-none max-md:translate-y-0 max-md:p-4 sm:max-w-md"
      >
        <DialogHeader>
          <DialogTitle>
            {t(kind === "file" ? "New file" : "New folder")}
          </DialogTitle>
          {parentFolder && (
            <DialogDescription className="truncate font-mono text-xs">
              {parentFolder}
            </DialogDescription>
          )}
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="grid gap-1.5">
            <Input
              autoFocus
              value={name}
              disabled={pending}
              data-iori-field="file-create-name"
              aria-label={t(kind === "file" ? "New file" : "New folder")}
              aria-invalid={Boolean(error)}
              className="[@media(pointer:coarse)]:h-11"
              onChange={(event) => {
                setName(event.target.value);
                if (error) setError(undefined);
              }}
            />
            {error && (
              <p className="text-xs text-status-failed-text" role="alert">
                {error}
              </p>
            )}
          </div>
          <DialogFooter className="mt-1 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              className="max-md:min-h-11 max-md:w-full max-md:text-sm"
              onClick={() => onOpenChange(false)}
            >
              {t("Cancel")}
            </Button>
            <Button
              type="submit"
              pending={pending}
              disabled={!name.trim()}
              data-iori-action="file-create-confirm"
              className="max-md:min-h-11 max-md:w-full max-md:text-sm"
            >
              {t("Create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export type FileRenameDialogProps = {
  target?: { path: string; name: string; isDirectory: boolean };
  locale: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (from: string, to: string) => Promise<string | undefined>;
};

export function FileRenameDialog({
  target,
  locale,
  onOpenChange,
  onSubmit,
}: FileRenameDialogProps) {
  const t = translator(locale);
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (target) {
      setName(target.name);
      setError(undefined);
      setPending(false);
    }
  }, [target]);

  const submit = async () => {
    if (!target || pending) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    if (trimmed === target.name) {
      onOpenChange(false);
      return;
    }
    const slash = target.path.lastIndexOf("/");
    const parent = slash < 0 ? "" : target.path.slice(0, slash);
    const to = parent ? `${parent}/${trimmed}` : trimmed;
    setPending(true);
    setError(undefined);
    try {
      const message = await onSubmit(target.path, to);
      if (message) setError(message);
      else onOpenChange(false);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={Boolean(target)}
      onOpenChange={(next) => {
        if (!next && !pending) onOpenChange(false);
      }}
    >
      <DialogContent
        data-iori-dialog="file-rename"
        className="max-md:top-auto max-md:bottom-3 max-md:w-[calc(100%-1.5rem)] max-md:max-w-none max-md:translate-y-0 max-md:p-4 sm:max-w-md"
        onOpenAutoFocus={(event) => {
          const input = inputRef.current;
          if (!input || !target) return;
          event.preventDefault();
          input.focus({ preventScroll: true });
          const dot = target.isDirectory ? -1 : target.name.lastIndexOf(".");
          if (dot > 0) input.setSelectionRange(0, dot);
          else input.select();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("Rename")}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="grid gap-1.5">
            <Input
              ref={inputRef}
              value={name}
              disabled={pending}
              data-iori-field="file-rename-name"
              aria-label={t("Rename")}
              aria-invalid={Boolean(error)}
              className="[@media(pointer:coarse)]:h-11"
              onChange={(event) => {
                setName(event.target.value);
                if (error) setError(undefined);
              }}
            />
            {error && (
              <p className="text-xs text-status-failed-text" role="alert">
                {error}
              </p>
            )}
          </div>
          <DialogFooter className="mt-1 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              className="max-md:min-h-11 max-md:w-full max-md:text-sm"
              onClick={() => onOpenChange(false)}
            >
              {t("Cancel")}
            </Button>
            <Button
              type="submit"
              pending={pending}
              disabled={!name.trim()}
              data-iori-action="file-rename-confirm"
              className="max-md:min-h-11 max-md:w-full max-md:text-sm"
            >
              {t("Rename")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export type FileDeleteDialogProps = {
  target?: {
    path: string;
    name: string;
    isDirectory: boolean;
    isSymlink: boolean;
  };
  locale: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: (path: string) => Promise<string | undefined>;
};

export function FileDeleteDialog({
  target,
  locale,
  onOpenChange,
  onConfirm,
}: FileDeleteDialogProps) {
  const t = translator(locale);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (target) {
      setError(undefined);
      setPending(false);
    }
  }, [target]);

  const confirm = async () => {
    if (!target || pending) return;
    setPending(true);
    setError(undefined);
    try {
      const message = await onConfirm(target.path);
      if (message) setError(message);
      else onOpenChange(false);
    } finally {
      setPending(false);
    }
  };

  const description = target
    ? target.isSymlink
      ? t("This deletes the link only. Its target will remain.")
      : target.isDirectory
        ? t(
            "This permanently deletes the folder and everything inside it, and cannot be undone.",
          )
        : t("This permanently deletes the file and cannot be undone.")
    : "";

  return (
    <Dialog
      open={Boolean(target)}
      onOpenChange={(next) => {
        if (!next && !pending) onOpenChange(false);
      }}
    >
      <DialogContent
        data-iori-dialog="file-delete"
        showCloseButton={false}
        className="max-md:top-auto max-md:bottom-3 max-md:w-[calc(100%-1.5rem)] max-md:max-w-none max-md:translate-y-0 max-md:p-4 sm:max-w-md"
      >
        <DialogHeader className="pr-0">
          <DialogTitle>
            {target
              ? t("Delete {name}?").replace("{name}", () => target.name)
              : ""}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {error && (
          <p className="text-xs text-status-failed-text" role="alert">
            {error}
          </p>
        )}
        <DialogFooter className="mt-1 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            autoFocus
            disabled={pending}
            className="max-md:min-h-11 max-md:w-full max-md:text-sm"
            onClick={() => onOpenChange(false)}
          >
            {t("Cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            pending={pending}
            data-iori-action="file-delete-confirm"
            className="max-md:min-h-11 max-md:w-full max-md:text-sm"
            onClick={() => void confirm()}
          >
            {t("Delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
