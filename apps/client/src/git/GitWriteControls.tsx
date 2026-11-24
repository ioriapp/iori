import { useEffect, useId, useState, type KeyboardEvent } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CircleAlert,
  RefreshCw,
  X,
} from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";

export type GitRemoteBarProps = {
  locale: string;
  ahead?: number;
  behind?: number;
  hasUpstream: boolean;
  busy?: "fetch" | "pull" | "push" | "stage" | "commit" | "discard" | null;
  error?: string;
  onDismissError?: () => void;
  onFetch: () => void;
  onPull: () => void;
  onPush: () => void;
};

export function GitRemoteBar({
  locale,
  ahead = 0,
  behind = 0,
  hasUpstream,
  busy = null,
  error,
  onDismissError,
  onFetch,
  onPull,
  onPush,
}: GitRemoteBarProps) {
  const ja = locale.startsWith("ja");
  const isBusy = Boolean(busy);
  const noUpstreamTitle = hasUpstream
    ? undefined
    : ja
      ? "上流ブランチが設定されていません"
      : "No upstream branch configured";
  const pushTitle = hasUpstream
    ? undefined
    : ja
      ? "リモートへpushして上流ブランチを設定"
      : "Push branch and set upstream";

  return (
    <div
      className="flex flex-col gap-1.5"
      data-iori-part="git-remote-bar"
      data-has-upstream={hasUpstream ? "true" : "false"}
    >
      <div className="flex flex-wrap items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isBusy}
          pending={busy === "fetch"}
          data-iori-action="git-fetch"
          className="[@media(pointer:coarse)]:min-h-11"
          onClick={onFetch}
        >
          <RefreshCw aria-hidden="true" />
          <span>fetch</span>
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isBusy || !hasUpstream}
          pending={busy === "pull"}
          title={noUpstreamTitle}
          data-iori-action="git-pull"
          className="[@media(pointer:coarse)]:min-h-11"
          onClick={onPull}
        >
          <ArrowDown aria-hidden="true" />
          <span>pull</span>
          {behind > 0 && (
            <Badge
              variant="secondary"
              className="h-4 px-1 font-mono text-2xs leading-none"
            >
              ↓{behind}
            </Badge>
          )}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isBusy}
          pending={busy === "push"}
          title={pushTitle}
          data-iori-action="git-push"
          className="[@media(pointer:coarse)]:min-h-11"
          onClick={onPush}
        >
          <ArrowUp aria-hidden="true" />
          <span>push</span>
          {ahead > 0 && (
            <Badge
              variant="secondary"
              className="h-4 px-1 font-mono text-2xs leading-none"
            >
              ↑{ahead}
            </Badge>
          )}
        </Button>
      </div>
      {error && (
        <div
          role="alert"
          data-iori-part="git-write-error"
          className="flex items-start gap-2 rounded-md border border-status-failed-border bg-status-failed-bg/35 px-2.5 py-1.5 text-xs text-foreground"
        >
          <CircleAlert
            className="mt-0.5 size-3.5 shrink-0 text-status-failed-text"
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere]">
            {error}
          </span>
          {onDismissError && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={ja ? "閉じる" : "Close"}
              data-iori-action="git-write-error-dismiss"
              className="-mr-1 shrink-0 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"
              onClick={onDismissError}
            >
              <X aria-hidden="true" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export type GitCommitBoxProps = {
  locale: string;
  stagedCount: number;
  hasUpstream: boolean;
  ahead?: number;
  busy?: boolean;
  onCommit: (message: string, amend: boolean) => Promise<boolean>;
  onRequestLastCommitMessage?: () => Promise<string | undefined>;
};

export function GitCommitBox({
  locale,
  stagedCount,
  hasUpstream,
  ahead,
  busy = false,
  onCommit,
  onRequestLastCommitMessage,
}: GitCommitBoxProps) {
  const ja = locale.startsWith("ja");
  const amendId = useId();
  const [message, setMessage] = useState("");
  const [amend, setAmend] = useState(false);
  const [localBusy, setLocalBusy] = useState(false);

  const submitting = busy || localBusy;
  const canCommit =
    !submitting && message.trim().length > 0 && (stagedCount > 0 || amend);
  const showPushedWarning =
    amend && hasUpstream && (ahead === undefined || ahead === 0);

  const toggleAmend = (next: boolean) => {
    setAmend(next);
    if (next && message.trim().length === 0 && onRequestLastCommitMessage) {
      void onRequestLastCommitMessage().then((lastMessage) => {
        if (!lastMessage) return;
        setMessage((current) =>
          current.trim().length === 0 ? lastMessage : current,
        );
      });
    }
  };

  const submit = async () => {
    if (!canCommit) return;
    setLocalBusy(true);
    try {
      const ok = await onCommit(message.trim(), amend);
      if (ok) {
        setMessage("");
        setAmend(false);
      }
    } finally {
      setLocalBusy(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      (event.ctrlKey || event.metaKey) &&
      event.key === "Enter" &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <div
      className="flex flex-col gap-2 rounded-md border border-border bg-card p-2.5"
      data-iori-part="git-commit-box"
    >
      <Textarea
        value={message}
        disabled={submitting}
        onChange={(event) => setMessage(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={ja ? "コミットメッセージを入力…" : "Commit message…"}
        aria-label={ja ? "コミットメッセージ" : "Commit message"}
        data-iori-field="git-commit-message"
        className="min-h-16 resize-y text-xs"
      />
      {showPushedWarning && (
        <div
          role="note"
          className="flex items-start gap-1.5 rounded-md border border-status-waiting-border bg-status-waiting-bg/50 px-2 py-1.5 text-xs text-foreground"
        >
          <AlertTriangle
            className="mt-0.5 size-3.5 shrink-0 text-status-waiting-text"
            aria-hidden="true"
          />
          <span className="min-w-0 [overflow-wrap:anywhere]">
            {ja
              ? "直前のコミットはpush済みの可能性があります。"
              : "The last commit may already be pushed."}
          </span>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Label
            htmlFor={amendId}
            className="cursor-pointer gap-1.5 text-xs font-normal text-foreground [@media(pointer:coarse)]:min-h-11"
          >
            <Checkbox
              id={amendId}
              checked={amend}
              disabled={submitting}
              data-iori-action="git-commit-amend"
              onCheckedChange={(checked) => toggleAmend(checked === true)}
            />
            <span>amend</span>
          </Label>
          {stagedCount === 0 && !amend && (
            <span className="text-2xs text-muted-foreground">
              {ja ? "ステージ済みの変更がありません" : "No staged changes"}
            </span>
          )}
        </div>
        <Button
          type="button"
          variant="default"
          size="sm"
          pending={submitting}
          disabled={!canCommit}
          data-iori-action="git-commit-submit"
          className="[@media(pointer:coarse)]:min-h-11"
          onClick={() => void submit()}
        >
          commit
        </Button>
      </div>
    </div>
  );
}

export type GitDiscardTarget = {
  label: string;
  untracked: boolean;
  hunk?: boolean;
};

export type GitDiscardDialogProps = {
  target?: GitDiscardTarget;
  locale: string;
  busy?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
};

export function GitDiscardDialog({
  target,
  locale,
  busy = false,
  onOpenChange,
  onConfirm,
}: GitDiscardDialogProps) {
  const ja = locale.startsWith("ja");
  const [localBusy, setLocalBusy] = useState(false);

  useEffect(() => {
    if (target) {
      setLocalBusy(false);
    }
  }, [target]);

  const submitting = busy || localBusy;

  const confirm = async () => {
    if (!target || submitting) return;
    setLocalBusy(true);
    try {
      await onConfirm();
    } finally {
      setLocalBusy(false);
    }
  };

  const title = target
    ? target.hunk
      ? ja
        ? "この変更箇所を破棄しますか？"
        : "Discard this hunk?"
      : target.untracked
        ? ja
          ? `${target.label} を削除しますか？`
          : `Delete untracked file ${target.label}?`
        : ja
          ? `${target.label} の変更を破棄しますか？`
          : `Discard changes in ${target.label}?`
    : "";

  const description = target
    ? target.untracked
      ? ja
        ? "未追跡ファイルは完全に削除され、元に戻せません。"
        : "This permanently deletes the untracked file and cannot be undone."
      : ja
        ? "破棄した変更は元に戻せません。"
        : "Discarded changes cannot be undone."
    : "";

  return (
    <Dialog
      open={Boolean(target)}
      onOpenChange={(next) => {
        if (!next && !submitting) onOpenChange(false);
      }}
    >
      <DialogContent
        data-iori-dialog="git-discard"
        showCloseButton={false}
        className="max-md:top-auto max-md:bottom-3 max-md:w-[calc(100%-1.5rem)] max-md:max-w-none max-md:translate-y-0 max-md:p-4 sm:max-w-md"
      >
        <DialogHeader className="pr-0">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-1 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            autoFocus
            disabled={submitting}
            className="max-md:min-h-11 max-md:w-full max-md:text-sm"
            onClick={() => onOpenChange(false)}
          >
            {ja ? "キャンセル" : "Cancel"}
          </Button>
          <Button
            type="button"
            variant="destructive"
            pending={submitting}
            data-iori-action="git-discard-confirm"
            className="max-md:min-h-11 max-md:w-full max-md:text-sm"
            onClick={() => void confirm()}
          >
            {target?.untracked
              ? ja
                ? "削除"
                : "Delete"
              : ja
                ? "変更を破棄"
                : "Discard"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
