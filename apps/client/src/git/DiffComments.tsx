import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  ChevronDown,
  ChevronRight,
  MessageSquare,
  Pencil,
  Trash2,
} from "lucide-react";
import { cn } from "cn";
import { Button } from "../components/ui/button";
import { Textarea } from "../components/ui/textarea";
import {
  AgentTargetPicker,
  type AgentTarget,
} from "../forge/AgentTargetPicker.tsx";
import { formatDiffCommentsForAgent, type DiffComment } from "./diff-review.ts";

export { formatDiffCommentsForAgent, type DiffComment };

function lineRangeLabel(startLine: number, endLine: number): string {
  return startLine === endLine ? `L${startLine}` : `L${startLine}–L${endLine}`;
}

function sideLabel(side: "old" | "new", ja: boolean): string {
  if (ja) return side === "old" ? "変更前" : "変更後";
  return side === "old" ? "Old" : "New";
}

export function DiffCommentComposer({
  path,
  side,
  startLine,
  endLine,
  initialBody = "",
  locale,
  onSubmit,
  onCancel,
}: {
  path: string;
  side: "old" | "new";
  startLine: number;
  endLine: number;
  initialBody?: string;
  locale: string;
  onSubmit: (body: string) => void;
  onCancel: () => void;
}) {
  const ja = locale.startsWith("ja");
  const isEditing = initialBody.length > 0;
  const [body, setBody] = useState(initialBody);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = () => {
    const trimmed = body.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      submit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }
  };

  return (
    <div
      className="my-1.5 rounded-md border border-border bg-card p-2.5 font-sans text-foreground shadow-xs"
      data-iori-view="diff-comment-composer"
      data-path={path}
      data-side={side}
    >
      <div className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="font-mono text-foreground">
          {lineRangeLabel(startLine, endLine)}
        </span>
        <span className="rounded-xs bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground">
          {sideLabel(side, ja)}
        </span>
        <span className="min-w-0 truncate" title={path}>
          {path}
        </span>
      </div>
      <Textarea
        ref={inputRef}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={ja ? "コメントを入力…" : "Write a comment…"}
        aria-label={ja ? "コメント" : "Comment"}
        data-iori-field="diff-comment-input"
        className="min-h-16 resize-y text-xs"
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-2xs text-muted-foreground">Ctrl+Enter / Esc</span>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-iori-action="diff-comment-cancel"
            onClick={onCancel}
          >
            {ja ? "キャンセル" : "Cancel"}
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            data-iori-action="diff-comment-save"
            disabled={body.trim().length === 0}
            onClick={submit}
          >
            {isEditing
              ? ja
                ? "保存"
                : "Save"
              : ja
                ? "コメントを追加"
                : "Add comment"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function DiffCommentCard({
  comment,
  locale,
  onEdit,
  onDelete,
}: {
  comment: DiffComment;
  locale: string;
  onEdit: (id: string, body: string) => void;
  onDelete: (id: string) => void;
}) {
  const ja = locale.startsWith("ja");
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <DiffCommentComposer
        path={comment.path}
        side={comment.side}
        startLine={comment.startLine}
        endLine={comment.endLine}
        initialBody={comment.body}
        locale={locale}
        onSubmit={(body) => {
          onEdit(comment.id, body);
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div
      className="my-1.5 rounded-md border border-border bg-card px-2.5 py-2 font-sans text-foreground shadow-xs"
      data-iori-part="diff-comment-card"
      data-comment-id={comment.id}
    >
      <div className="mb-1 flex items-center gap-1.5 text-xs">
        <span className="font-mono font-medium text-foreground">
          {lineRangeLabel(comment.startLine, comment.endLine)}
        </span>
        <span className="rounded-xs bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground">
          {sideLabel(comment.side, ja)}
        </span>
        <span className="flex-1" />
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          data-iori-action="diff-comment-edit"
          aria-label={ja ? "編集" : "Edit"}
          title={ja ? "編集" : "Edit"}
          onClick={() => setEditing(true)}
        >
          <Pencil />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          data-iori-action="diff-comment-delete"
          aria-label={ja ? "削除" : "Delete"}
          title={ja ? "削除" : "Delete"}
          onClick={() => onDelete(comment.id)}
        >
          <Trash2 />
        </Button>
      </div>
      <p className="m-0 text-xs whitespace-pre-wrap break-words text-foreground">
        {comment.body}
      </p>
    </div>
  );
}

export function DiffCommentsBar({
  comments,
  locale,
  targets,
  canSend,
  onSelectComment,
  onDeleteComment,
  onClearAll,
  onSendToAgent,
}: {
  comments: DiffComment[];
  locale: string;
  targets?: AgentTarget[];
  canSend: boolean;
  onSelectComment: (comment: DiffComment) => void;
  onDeleteComment: (id: string) => void;
  onClearAll: () => void;
  onSendToAgent: (terminalId?: string) => void;
}) {
  const ja = locale.startsWith("ja");
  const [expanded, setExpanded] = useState(false);

  if (comments.length === 0) return null;

  const countLabel = ja
    ? `コメント ${comments.length}件`
    : `${comments.length} ${comments.length === 1 ? "comment" : "comments"}`;
  const resolvedTargets: AgentTarget[] =
    targets ??
    (canSend
      ? [
          {
            terminalId: "",
            worktreePath: "",
            label: "",
            isTeamParent: false,
          },
        ]
      : []);

  return (
    <div
      className="flex-none border-t border-border bg-muted/40 font-sans"
      data-iori-part="diff-comments-bar"
    >
      <div className="flex min-h-9 flex-wrap items-center gap-1.5 px-2 py-1">
        <button
          type="button"
          className="inline-flex cursor-pointer items-center gap-1 rounded-sm border-0 bg-transparent px-1.5 py-1 text-xs font-medium text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40"
          aria-expanded={expanded}
          data-iori-action="diff-comments-toggle"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? (
            <ChevronDown className="size-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3.5 text-muted-foreground" />
          )}
          <MessageSquare className="size-3.5 text-primary" />
          <span>{countLabel}</span>
        </button>
        <span className="flex-1" />
        <Button
          type="button"
          variant="ghost"
          size="xs"
          data-iori-action="diff-comments-clear"
          onClick={onClearAll}
        >
          {ja ? "クリア" : "Clear"}
        </Button>
        <AgentTargetPicker
          targets={canSend ? resolvedTargets : []}
          locale={locale}
          label={ja ? "コメントをAgentへ送信" : "Send comments to Agent"}
          actionId="diff-comments-send"
          size="xs"
          variant="default"
          onSend={(terminalId) => onSendToAgent(terminalId || undefined)}
        />
      </div>
      {expanded && (
        <ul
          className="m-0 max-h-48 list-none overflow-y-auto border-t border-border-subtle bg-background p-1"
          data-iori-part="diff-comments-list"
        >
          {comments.map((comment) => (
            <li
              key={comment.id}
              className="flex items-center gap-1 rounded-sm hover:bg-muted/70"
            >
              <button
                type="button"
                className={cn(
                  "flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 border-0 bg-transparent px-2 py-1 text-left text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                )}
                data-iori-action="diff-comments-select"
                onClick={() => onSelectComment(comment)}
              >
                <span className="flex-none font-mono text-2xs text-primary">
                  {lineRangeLabel(comment.startLine, comment.endLine)}
                </span>
                <span className="flex-none truncate text-muted-foreground">
                  {comment.path}
                </span>
                <span className="min-w-0 flex-1 truncate text-foreground">
                  {comment.body}
                </span>
              </button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="flex-none"
                data-iori-action="diff-comment-delete"
                aria-label={ja ? "削除" : "Delete"}
                title={ja ? "削除" : "Delete"}
                onClick={() => onDeleteComment(comment.id)}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
