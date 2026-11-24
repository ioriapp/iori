import { useEffect, useState, type FormEvent } from "react";
import {
  AlertCircle,
  Check,
  ExternalLink,
  FileDiff,
  GitBranch,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  MessageSquare,
  RotateCw,
} from "lucide-react";
import type {
  ForgeCiState,
  ForgePrComment,
  ForgePrDetail,
  ForgePrFile,
  ForgePrReviewState,
  ForgePrState,
  ForgePrView,
  ForgeReadFailure,
} from "@iori/protocol";
import { AsyncState } from "../components/AsyncState.tsx";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import { Checkbox } from "../components/ui/checkbox.tsx";
import { Input } from "../components/ui/input.tsx";
import { Label } from "../components/ui/label.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.tsx";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../components/ui/tabs.tsx";
import { Textarea } from "../components/ui/textarea.tsx";
import { ChangeIcon, kindName } from "../git/changes.tsx";
import { IssueMarkdown } from "../issues/IssueMarkdown.tsx";
import { cn } from "../lib/utils.ts";
import { formatDate } from "../reading/format.ts";
import { AgentTargetPicker, type AgentTarget } from "./AgentTargetPicker.tsx";
import { CiStateIcon } from "./CiStateIcon.tsx";
import { ForgeFailure, ForgeNotice } from "./ForgeFailure.tsx";
import { formatPrCommentsForAgent } from "./pr-agent.ts";

export type PrState = ForgePrState;
export type PrReviewState = ForgePrReviewState;
export type PrFile = ForgePrFile;
export type PrComment = ForgePrComment;
export type PrDetail = ForgePrDetail;
export type PrView = ForgePrView;
export type PrCiSummary = { state: ForgeCiState; label: string };

export type PrPaneProps = {
  locale: string;
  prView?: PrView;
  loading: boolean;
  error?: { forge?: ForgeReadFailure; message?: string };
  ciSummary?: PrCiSummary;
  onOpenCi?: () => void;
  onReload: () => void;
  onOpenIntegrations?: () => void;
  onOpenWorkspaceSettings?: () => void;
  onOpenInBrowser: (url: string) => void;
  onOpenChangedFile?: (path: string, baseBranch: string) => void;
  agentTargets: AgentTarget[];
  onSendTextToTerminal?: (text: string, terminalId?: string) => boolean;
  onCreatePr: (input: {
    title: string;
    body: string;
    base?: string;
    draft: boolean;
    issue?: number;
  }) => Promise<
    | { ok: true; url: string; created?: boolean }
    | { ok: false; message?: string; forge?: ForgeReadFailure }
  >;
};

type CommentThread = {
  root: PrComment;
  replies: PrComment[];
};

function groupCommentThreads(
  comments: ReadonlyArray<PrComment>,
): CommentThread[] {
  const byId = new Map(comments.map((comment) => [comment.id, comment]));
  const rootIdOf = (comment: PrComment): string => {
    const seen = new Set<string>([comment.id]);
    let current = comment;
    while (current.inReplyToId) {
      const parent = byId.get(current.inReplyToId);
      if (!parent || seen.has(parent.id)) break;
      seen.add(parent.id);
      current = parent;
    }
    return current.id;
  };
  const threads = new Map<string, CommentThread>();
  const ordered: CommentThread[] = [];
  for (const comment of comments) {
    const rootId = rootIdOf(comment);
    if (rootId === comment.id) {
      const existing = threads.get(rootId);
      if (existing) {
        existing.root = comment;
      } else {
        const thread: CommentThread = { root: comment, replies: [] };
        threads.set(rootId, thread);
        ordered.push(thread);
      }
    } else {
      let thread = threads.get(rootId);
      if (!thread) {
        const rootComment = byId.get(rootId) ?? comment;
        thread = { root: rootComment, replies: [] };
        threads.set(rootId, thread);
        ordered.push(thread);
      }
      thread.replies.push(comment);
    }
  }
  return ordered;
}

const MAX_COMPACT_HUNK_LINES = 12;

function compactDiffHunk(raw: string): string {
  const lines = raw.replace(/\r\n/gu, "\n").replace(/\r/gu, "\n").split("\n");
  while (lines.length > 0 && lines.at(-1) === "") lines.pop();
  const tail =
    lines.length > MAX_COMPACT_HUNK_LINES
      ? lines.slice(-MAX_COMPACT_HUNK_LINES)
      : lines;
  return tail.join("\n");
}

function PrStateBadge({ state }: { state: PrState }) {
  switch (state) {
    case "open":
      return (
        <Badge variant="running">
          <GitPullRequest aria-hidden="true" />
          Open
        </Badge>
      );
    case "draft":
      return (
        <Badge variant="neutral">
          <GitPullRequestDraft aria-hidden="true" />
          Draft
        </Badge>
      );
    case "merged":
      return (
        <Badge
          variant="secondary"
          className="border-primary/30 bg-primary/10 text-primary"
        >
          <GitMerge aria-hidden="true" />
          Merged
        </Badge>
      );
    case "closed":
      return (
        <Badge variant="failed">
          <GitPullRequestClosed aria-hidden="true" />
          Closed
        </Badge>
      );
  }
}

function ReviewStateBadge({ state }: { state: PrReviewState }) {
  switch (state) {
    case "approved":
      return (
        <Badge variant="running">
          <Check aria-hidden="true" />
          Approved
        </Badge>
      );
    case "changes_requested":
      return <Badge variant="failed">Changes requested</Badge>;
    case "commented":
      return <Badge variant="outline">Commented</Badge>;
    case "pending":
      return <Badge variant="waiting">Pending</Badge>;
  }
}

function LabelChip({ label }: { label: { name: string; color?: string } }) {
  return (
    <span
      className="inline-flex h-5 max-w-full items-center gap-1.5 truncate rounded-sm border border-border bg-background px-2 text-2xs font-medium text-foreground"
      data-iori-label={label.name}
    >
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-full bg-muted-foreground"
        style={label.color ? { backgroundColor: label.color } : undefined}
      />
      <span className="truncate">{label.name}</span>
    </span>
  );
}

function PrDetailView({
  pr,
  ciSummary,
  onOpenCi,
  canCreateNew,
  onStartCreateNew,
  locale,
  loading,
  onReload,
  onOpenInBrowser,
  onOpenChangedFile,
  agentTargets,
  onSendTextToTerminal,
}: {
  pr: PrDetail;
  ciSummary?: PrCiSummary;
  onOpenCi?: () => void;
  canCreateNew?: boolean;
  onStartCreateNew?: () => void;
  locale: string;
  loading: boolean;
  onReload: () => void;
  onOpenInBrowser: (url: string) => void;
  onOpenChangedFile?: (path: string, baseBranch: string) => void;
  agentTargets: AgentTarget[];
  onSendTextToTerminal?: (text: string, terminalId?: string) => boolean;
}) {
  const ja = locale.startsWith("ja");
  const [section, setSection] = useState<"overview" | "files" | "comments">(
    "overview",
  );

  const sendComments = (comments: PrComment[], terminalId?: string) => {
    if (!onSendTextToTerminal) return;
    const text = formatPrCommentsForAgent(pr, comments);
    onSendTextToTerminal(text, terminalId);
  };

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      data-iori-part="pr-detail"
    >
      <header className="flex flex-col gap-2.5 border-b border-border px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <PrStateBadge state={pr.state} />
              <span className="font-mono text-xs text-muted-foreground">
                #{pr.number}
              </span>
              <span className="text-xs text-muted-foreground">
                {pr.author} · {formatDate(pr.createdAt, locale)}
              </span>
            </div>
            <h2 className="m-0 text-base font-semibold leading-snug text-foreground [overflow-wrap:anywhere]">
              {pr.title}
            </h2>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={loading}
              aria-label={ja ? "再読み込み" : "Reload"}
              title={ja ? "再読み込み" : "Reload"}
              onClick={onReload}
            >
              <RotateCw
                className={cn("size-3.5", loading && "animate-spin")}
                aria-hidden="true"
              />
            </Button>
            {canCreateNew && onStartCreateNew && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-iori-action="pr-open-create"
                onClick={onStartCreateNew}
              >
                <GitPullRequest aria-hidden="true" />
                <span>{ja ? "新しいPRを作成" : "Create new PR"}</span>
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-iori-action="pr-open-browser"
              onClick={() => onOpenInBrowser(pr.url)}
            >
              <ExternalLink aria-hidden="true" />
              <span>{ja ? "ブラウザーで開く" : "Open in browser"}</span>
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <GitBranch className="size-3.5 shrink-0" aria-hidden="true" />
          <code className="rounded-sm border border-border-subtle bg-muted px-1.5 py-0.5 font-mono text-2xs text-foreground">
            {pr.baseBranch}
          </code>
          <span aria-hidden="true">←</span>
          <code className="rounded-sm border border-border-subtle bg-muted px-1.5 py-0.5 font-mono text-2xs text-foreground">
            {pr.headBranch}
          </code>
        </div>

        {(pr.labels.length > 0 || pr.reviewers.length > 0) && (
          <dl className="m-0 flex flex-col gap-1.5 pt-1 text-xs">
            {pr.labels.length > 0 && (
              <div className="flex min-w-0 items-baseline gap-3">
                <dt className="w-[6em] shrink-0 text-muted-foreground">
                  {ja ? "ラベル" : "Labels"}
                </dt>
                <dd className="m-0 flex min-w-0 flex-wrap gap-1.5">
                  {pr.labels.map((label) => (
                    <LabelChip key={label.name} label={label} />
                  ))}
                </dd>
              </div>
            )}
            {pr.reviewers.length > 0 && (
              <div className="flex min-w-0 items-baseline gap-3">
                <dt className="w-[6em] shrink-0 text-muted-foreground">
                  {ja ? "レビュアー" : "Reviewers"}
                </dt>
                <dd className="m-0 flex min-w-0 flex-wrap items-center gap-2">
                  {pr.reviewers.map((reviewer) => (
                    <span
                      key={reviewer.login}
                      className="inline-flex items-center gap-1.5 text-foreground"
                    >
                      <span className="[overflow-wrap:anywhere]">
                        {reviewer.login}
                      </span>
                      {reviewer.state && (
                        <ReviewStateBadge state={reviewer.state} />
                      )}
                    </span>
                  ))}
                </dd>
              </div>
            )}
          </dl>
        )}
      </header>

      <Tabs
        value={section}
        onValueChange={(value) => {
          if (
            value === "overview" ||
            value === "files" ||
            value === "comments"
          ) {
            setSection(value);
          }
        }}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <div className="border-b border-border px-5">
          <TabsList variant="line" className="border-b-0">
            <TabsTrigger value="overview">
              {ja ? "概要" : "Overview"}
            </TabsTrigger>
            <TabsTrigger value="files">
              <FileDiff aria-hidden="true" />
              <span>{ja ? "変更ファイル" : "Files"}</span>
              <Badge variant="secondary" className="h-4 px-1 text-2xs">
                {pr.files.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="comments">
              <MessageSquare aria-hidden="true" />
              <span>{ja ? "レビューコメント" : "Comments"}</span>
              <Badge variant="secondary" className="h-4 px-1 text-2xs">
                {pr.comments.length}
              </Badge>
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent
          value="overview"
          className="min-h-0 flex-1 overflow-y-auto px-5 py-4"
          data-iori-part="pr-body"
        >
          {ciSummary && (
            <div
              data-iori-part="pr-ci-summary"
              className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border-subtle bg-muted/40 px-3 py-2 text-xs"
            >
              <span className="flex items-center gap-2 font-medium text-foreground">
                <CiStateIcon state={ciSummary.state} size={14} />
                <span>{ciSummary.label}</span>
              </span>
              {onOpenCi && (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  data-iori-action="pr-open-ci"
                  onClick={onOpenCi}
                >
                  {ja ? "CIを表示" : "View CI"}
                </Button>
              )}
            </div>
          )}
          {pr.body.trim() ? (
            <IssueMarkdown text={pr.body} base={pr.url} locale={locale} />
          ) : (
            <p className="m-0 text-xs text-muted-foreground">
              {ja ? "説明はありません。" : "No description provided."}
            </p>
          )}
        </TabsContent>

        <TabsContent
          value="files"
          className="min-h-0 flex-1 overflow-y-auto px-5 py-4"
          data-iori-part="pr-files"
        >
          {pr.files.length === 0 ? (
            <p className="m-0 text-xs text-muted-foreground">
              {ja ? "変更ファイルはありません。" : "No changed files."}
            </p>
          ) : (
            <ul className="m-0 flex list-none flex-col divide-y divide-border-subtle rounded-md border border-border p-0">
              {pr.files.map((file) => {
                const interactive = Boolean(onOpenChangedFile);
                return (
                  <li key={`${file.status}:${file.oldPath ?? ""}:${file.path}`}>
                    <button
                      type="button"
                      data-iori-action="pr-file-open"
                      data-path={file.path}
                      disabled={!interactive}
                      onClick={() =>
                        onOpenChangedFile?.(file.path, pr.baseBranch)
                      }
                      className={cn(
                        "flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors outline-none",
                        interactive
                          ? "cursor-pointer hover:bg-accent/50 focus-visible:bg-accent/50 [@media(pointer:coarse)]:min-h-11"
                          : "cursor-default",
                      )}
                    >
                      <ChangeIcon kind={file.status} ja={ja} />
                      <span className="sr-only">
                        {kindName(file.status, ja)}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-mono text-foreground">
                        {file.status === "renamed" && file.oldPath
                          ? `${file.oldPath} → ${file.path}`
                          : file.path}
                      </span>
                      {(file.additions !== undefined ||
                        file.deletions !== undefined) && (
                        <span className="flex shrink-0 items-center gap-1.5 font-mono text-2xs">
                          {file.additions !== undefined && (
                            <span className="text-diff-add-text">
                              +{file.additions}
                            </span>
                          )}
                          {file.deletions !== undefined && (
                            <span className="text-diff-del-text">
                              −{file.deletions}
                            </span>
                          )}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </TabsContent>

        <TabsContent
          value="comments"
          className="min-h-0 flex-1 overflow-y-auto px-5 py-4"
          data-iori-part="pr-comments"
        >
          {pr.comments.length === 0 ? (
            <p className="m-0 text-xs text-muted-foreground">
              {ja ? "コメントはありません。" : "No comments yet."}
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  {ja
                    ? `${pr.comments.length}件のコメント`
                    : `${pr.comments.length} ${pr.comments.length === 1 ? "comment" : "comments"}`}
                </span>
                <AgentTargetPicker
                  targets={agentTargets}
                  locale={locale}
                  label={
                    ja
                      ? "すべてのコメントをAgentへ送信"
                      : "Send all comments to Agent"
                  }
                  actionId="pr-comments-send-all"
                  disabled={!onSendTextToTerminal}
                  onSend={(terminalId) => sendComments(pr.comments, terminalId)}
                />
              </div>

              <div className="flex flex-col gap-3">
                {groupCommentThreads(pr.comments).map((thread) => {
                  const allInThread = [thread.root, ...thread.replies];
                  const renderCommentBody = (
                    comment: PrComment,
                    isReply: boolean,
                  ) => {
                    const hunk =
                      !isReply && comment.diffHunk
                        ? compactDiffHunk(comment.diffHunk)
                        : "";
                    return (
                      <article
                        key={comment.id}
                        className={cn(
                          "flex min-w-0 flex-col gap-2",
                          isReply &&
                            "border-l-2 border-border-subtle pl-3 pt-2",
                        )}
                      >
                        <header className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <b className="font-semibold text-foreground [overflow-wrap:anywhere]">
                              {comment.author}
                            </b>
                            <span className="text-muted-foreground">
                              {formatDate(comment.createdAt, locale)}
                            </span>
                          </div>
                          <AgentTargetPicker
                            targets={agentTargets}
                            locale={locale}
                            size="xs"
                            label={ja ? "Agentへ送信" : "Send to Agent"}
                            actionId="pr-comment-send"
                            disabled={!onSendTextToTerminal}
                            onSend={(terminalId) =>
                              sendComments([comment], terminalId)
                            }
                          />
                        </header>

                        {!isReply && comment.path && (
                          <div className="flex flex-col gap-1.5">
                            <code className="w-fit max-w-full truncate rounded-sm border border-border-subtle bg-muted px-1.5 py-0.5 font-mono text-2xs text-foreground">
                              {comment.line !== undefined
                                ? `${comment.path}:${comment.line}`
                                : comment.path}
                            </code>
                            {hunk && (
                              <pre className="m-0 max-h-48 overflow-auto rounded-sm border border-border-subtle bg-muted/50 px-2.5 py-2 font-mono text-2xs leading-relaxed text-foreground">
                                <code>{hunk}</code>
                              </pre>
                            )}
                          </div>
                        )}

                        <IssueMarkdown
                          text={comment.body}
                          base={comment.url ?? pr.url}
                          locale={locale}
                        />
                      </article>
                    );
                  };
                  return (
                    <div
                      key={thread.root.id}
                      data-iori-part="pr-comment-thread"
                      className="flex min-w-0 flex-col gap-2 rounded-md border border-border bg-card p-3.5"
                    >
                      {renderCommentBody(thread.root, false)}
                      {thread.replies.length > 0 && (
                        <div className="flex flex-col gap-2 border-t border-border-subtle pt-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-2xs text-muted-foreground">
                              {ja
                                ? `${thread.replies.length}件の返信`
                                : `${thread.replies.length} ${thread.replies.length === 1 ? "reply" : "replies"}`}
                            </span>
                            <AgentTargetPicker
                              targets={agentTargets}
                              locale={locale}
                              size="xs"
                              label={
                                ja
                                  ? "スレッドをAgentへ送信"
                                  : "Send thread to Agent"
                              }
                              actionId="pr-thread-send"
                              disabled={!onSendTextToTerminal}
                              onSend={(terminalId) =>
                                sendComments(allInThread, terminalId)
                              }
                            />
                          </div>
                          {thread.replies.map((reply) =>
                            renderCommentBody(reply, true),
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function PrCreateForm({
  prView,
  locale,
  onReload,
  onBackToDetail,
  onOpenIntegrations,
  onOpenWorkspaceSettings,
  onOpenInBrowser,
  onCreatePr,
}: {
  prView: PrView;
  locale: string;
  onReload: () => void;
  onBackToDetail?: () => void;
  onOpenIntegrations?: () => void;
  onOpenWorkspaceSettings?: () => void;
  onOpenInBrowser: (url: string) => void;
  onCreatePr: PrPaneProps["onCreatePr"];
}) {
  const ja = locale.startsWith("ja");
  const branchOptions = Array.from(
    new Set(
      [
        ...(prView.defaultBranch ? [prView.defaultBranch] : []),
        ...(prView.branches ?? []),
      ].filter((branch) => branch.length > 0),
    ),
  );
  const initialBase = prView.defaultBranch ?? branchOptions[0] ?? "";

  const [title, setTitle] = useState("");
  const [base, setBase] = useState(initialBase);
  const [body, setBody] = useState("");
  const [issueText, setIssueText] = useState("");
  const [draft, setDraft] = useState(true);
  const [pending, setPending] = useState(false);
  const [submitError, setSubmitError] = useState<{
    message?: string;
    forge?: ForgeReadFailure;
  }>();
  const [createdResult, setCreatedResult] = useState<{
    url: string;
    created?: boolean;
  }>();

  useEffect(() => {
    if (!base && initialBase) {
      setBase(initialBase);
    }
  }, [base, initialBase]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setSubmitError({
        message: ja ? "題名を入力してください。" : "Please enter a title.",
      });
      return;
    }

    const trimmedIssue = issueText.trim();
    let issueNumber: number | undefined;
    if (trimmedIssue) {
      if (!/^\d+$/u.test(trimmedIssue)) {
        setSubmitError({
          message: ja
            ? "関連Issue番号は正の整数で入力してください。"
            : "Related issue number must be a positive integer.",
        });
        return;
      }
      const parsed = Number.parseInt(trimmedIssue, 10);
      if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        setSubmitError({
          message: ja
            ? "関連Issue番号は正の整数で入力してください。"
            : "Related issue number must be a positive integer.",
        });
        return;
      }
      issueNumber = parsed;
    }

    setPending(true);
    setSubmitError(undefined);
    try {
      const result = await onCreatePr({
        title: trimmedTitle,
        body,
        ...(base.trim() ? { base: base.trim() } : {}),
        draft,
        ...(issueNumber !== undefined ? { issue: issueNumber } : {}),
      });
      if (result.ok) {
        setCreatedResult({ url: result.url, created: result.created });
        onReload();
      } else {
        setSubmitError({
          message: result.message,
          forge: result.forge,
        });
      }
    } catch (err) {
      setSubmitError({
        message:
          err instanceof Error
            ? err.message
            : ja
              ? "PRを作成できませんでした。"
              : "Could not create the PR.",
      });
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
      <form
        className="mx-auto flex max-w-2xl flex-col gap-4"
        data-iori-part="pr-create-form"
        onSubmit={(event) => void handleSubmit(event)}
      >
        <div className="flex flex-col gap-1">
          <h2 className="m-0 text-base font-semibold text-foreground">
            {ja ? "PRを作成" : "Create PR"}
          </h2>
          {prView.currentBranch && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <GitBranch className="size-3.5 shrink-0" aria-hidden="true" />
              <code className="rounded-sm border border-border-subtle bg-muted px-1.5 py-0.5 font-mono text-2xs text-foreground">
                {base || prView.defaultBranch || "main"}
              </code>
              <span aria-hidden="true">←</span>
              <code className="rounded-sm border border-border-subtle bg-muted px-1.5 py-0.5 font-mono text-2xs text-foreground">
                {prView.currentBranch}
              </code>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pr-create-title">
            {ja ? "題名" : "Title"}
            <span className="text-status-failed-text" aria-hidden="true">
              *
            </span>
          </Label>
          <Input
            id="pr-create-title"
            data-iori-field="pr-create-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={ja ? "PRの題名を入力" : "Enter PR title"}
            required
            disabled={pending}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pr-create-base">
            {ja ? "ベースブランチ" : "Base branch"}
          </Label>
          {branchOptions.length > 0 ? (
            <Select value={base} onValueChange={setBase} disabled={pending}>
              <SelectTrigger
                id="pr-create-base"
                data-iori-field="pr-create-base"
                className="w-full"
              >
                <SelectValue
                  placeholder={
                    ja ? "ベースブランチを選択" : "Select base branch"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {branchOptions.map((branch) => (
                  <SelectItem key={branch} value={branch}>
                    {branch}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              id="pr-create-base"
              data-iori-field="pr-create-base"
              value={base}
              onChange={(event) => setBase(event.target.value)}
              placeholder={prView.defaultBranch ?? "main"}
              disabled={pending}
            />
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pr-create-body">{ja ? "本文" : "Description"}</Label>
          <Textarea
            id="pr-create-body"
            data-iori-field="pr-create-body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder={
              ja ? "変更内容の説明を入力（任意）" : "Describe your changes"
            }
            rows={6}
            disabled={pending}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pr-create-issue">
            {ja ? "関連Issue番号（任意）" : "Related Issue number (optional)"}
          </Label>
          <Input
            id="pr-create-issue"
            data-iori-field="pr-create-issue"
            inputMode="numeric"
            value={issueText}
            onChange={(event) => setIssueText(event.target.value)}
            placeholder="123"
            disabled={pending}
          />
          <p className="m-0 text-xs text-muted-foreground">
            {ja
              ? "入力すると本文の末尾に Closes #123 を追加します。"
              : "Appends Closes #123 to the description when provided."}
          </p>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <Checkbox
            id="pr-create-draft"
            data-iori-action="pr-create-draft"
            checked={draft}
            onCheckedChange={(checked) => setDraft(checked === true)}
            disabled={pending}
          />
          <Label htmlFor="pr-create-draft" className="cursor-pointer">
            {ja ? "Draftとして作成" : "Create as Draft"}
          </Label>
        </div>

        {submitError &&
          (submitError.forge ? (
            <ForgeFailure
              form="line"
              state="pr-create-failed"
              retryAction="pr-create-retry"
              subject={
                submitError.message ||
                (ja ? "PRを作成できませんでした。" : "Could not create the PR.")
              }
              failure={submitError.forge}
              locale={locale}
              recovery={{
                onRetry: onReload,
                onOpenIntegrations,
                onOpenWorkspaceSettings,
              }}
            />
          ) : (
            <div
              role="alert"
              data-iori-state="pr-create-failed"
              className="flex items-start gap-2 rounded-md border border-status-failed-border bg-status-failed-bg/35 px-3 py-2 text-xs text-foreground"
            >
              <AlertCircle
                className="mt-0.5 size-3.5 shrink-0 text-status-failed-text"
                aria-hidden="true"
              />
              <span className="[overflow-wrap:anywhere]">
                {submitError.message ||
                  (ja
                    ? "PRを作成できませんでした。"
                    : "Could not create the PR.")}
              </span>
            </div>
          ))}

        {createdResult && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-status-running-border bg-status-running-bg/35 px-3 py-2 text-xs text-foreground">
            <span>
              {createdResult.created === false
                ? ja
                  ? "既存のPRが見つかりました。"
                  : "Existing PR found."
                : ja
                  ? "PRを作成しました。"
                  : "PR created."}
            </span>
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => onOpenInBrowser(createdResult.url)}
            >
              <ExternalLink aria-hidden="true" />
              <span>{ja ? "ブラウザーで開く" : "Open in browser"}</span>
            </Button>
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <Button
            type="submit"
            data-iori-action="pr-create-submit"
            disabled={pending || !title.trim()}
          >
            {pending
              ? ja
                ? "作成中"
                : "Creating"
              : ja
                ? "PRを作成"
                : "Create PR"}
          </Button>
          {onBackToDetail && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={onBackToDetail}
            >
              {ja ? "PR詳細へ戻る" : "Back to PR"}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}

function cannotCreateMessage(
  reason: PrView["reason"],
  locale: string,
): { title: string; detail?: string } {
  const ja = locale.startsWith("ja");
  switch (reason) {
    case "default_branch":
      return {
        title: ja
          ? "既定ブランチからはPRを作成できません。"
          : "Cannot create a PR from the default branch.",
        detail: ja
          ? "別のブランチへ切り替えてから作成してください。"
          : "Switch to another branch to create a PR.",
      };
    case "no_push_target":
      return {
        title: ja
          ? "このブランチにはpush先がありません。"
          : "This branch has no push target.",
        detail: ja
          ? "PRを作成するには、ブランチをpushしてください。"
          : "Push the branch to create a PR.",
      };
    case "detached_head":
      return {
        title: ja
          ? "detached HEAD の状態ではPRを作成できません。"
          : "Cannot create a PR from a detached HEAD.",
        detail: ja
          ? "ブランチをチェックアウトしてください。"
          : "Check out a branch first.",
      };
    case "unsupported":
      return {
        title: ja
          ? "このリポジトリのForgeではPRを作成できません。"
          : "PR creation is not supported for this repository's Forge.",
      };
    default:
      return {
        title: ja
          ? "このブランチではPRを作成できません。"
          : "Cannot create a PR for this branch.",
      };
  }
}

export function PrPane({
  locale,
  prView,
  loading,
  error,
  ciSummary,
  onOpenCi,
  onReload,
  onOpenIntegrations,
  onOpenWorkspaceSettings,
  onOpenInBrowser,
  onOpenChangedFile,
  agentTargets,
  onSendTextToTerminal,
  onCreatePr,
}: PrPaneProps) {
  const ja = locale.startsWith("ja");
  const [creatingNew, setCreatingNew] = useState(false);
  const prKey = prView?.pr ? `${prView.pr.number}:${prView.pr.state}` : "";
  useEffect(() => {
    setCreatingNew(false);
  }, [prKey]);
  const recovery = {
    onRetry: onReload,
    onOpenIntegrations,
    onOpenWorkspaceSettings,
  };
  const readErrorSubject =
    error?.message ||
    (ja ? "PRを読み込めませんでした。" : "Could not read the PR.");

  if (error && !prView) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-background">
        <ForgeFailure
          form="notice"
          state="pr-failed"
          retryAction="pr-retry"
          subject={readErrorSubject}
          failure={error.forge}
          locale={locale}
          recovery={recovery}
        />
      </div>
    );
  }

  if (loading && !prView) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-background">
        <AsyncState
          mode="loading"
          loadingLabel={ja ? "読み込み中" : "Loading"}
          emptyTitle=""
          errorTitle=""
          className="border-t-0"
        >
          {null}
        </AsyncState>
      </div>
    );
  }

  if (!prView) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-background">
        <ForgeNotice>
          <p>{ja ? "PRの情報はありません。" : "No PR information."}</p>
        </ForgeNotice>
      </div>
    );
  }

  const notice =
    !prView.pr && !prView.canCreate
      ? cannotCreateMessage(prView.reason, locale)
      : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background text-sm">
      {error && (
        <div className="border-b border-border px-5 py-2.5">
          <ForgeFailure
            form="line"
            state="pr-failed"
            retryAction="pr-retry"
            subject={readErrorSubject}
            failure={error.forge}
            locale={locale}
            recovery={recovery}
          />
        </div>
      )}

      {prView.pr && !(creatingNew && prView.canCreate) ? (
        <PrDetailView
          pr={prView.pr}
          ciSummary={ciSummary}
          onOpenCi={onOpenCi}
          canCreateNew={
            prView.canCreate &&
            (prView.pr.state === "closed" || prView.pr.state === "merged")
          }
          onStartCreateNew={() => setCreatingNew(true)}
          locale={locale}
          loading={loading}
          onReload={onReload}
          onOpenInBrowser={onOpenInBrowser}
          onOpenChangedFile={onOpenChangedFile}
          agentTargets={agentTargets}
          onSendTextToTerminal={onSendTextToTerminal}
        />
      ) : prView.canCreate ? (
        <PrCreateForm
          prView={prView}
          locale={locale}
          onReload={onReload}
          onBackToDetail={prView.pr ? () => setCreatingNew(false) : undefined}
          onOpenIntegrations={onOpenIntegrations}
          onOpenWorkspaceSettings={onOpenWorkspaceSettings}
          onOpenInBrowser={onOpenInBrowser}
          onCreatePr={onCreatePr}
        />
      ) : (
        <ForgeNotice data-iori-state="pr-cannot-create">
          <p className="font-medium text-foreground">{notice?.title}</p>
          {notice?.detail && <p className="text-xs">{notice.detail}</p>}
          <Button type="button" variant="outline" size="sm" onClick={onReload}>
            <RotateCw aria-hidden="true" />
            <span>{ja ? "再読み込み" : "Reload"}</span>
          </Button>
        </ForgeNotice>
      )}
    </div>
  );
}
