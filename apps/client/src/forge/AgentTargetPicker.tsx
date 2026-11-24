import { useState } from "react";
import { ChevronDown, Send } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../components/ui/tooltip";

export type AgentTarget = {
  terminalId: string;
  worktreePath: string;
  label: string;
  isTeamParent: boolean;
  cliName?: string;
};

export type AgentTargetPickerProps = {
  targets: AgentTarget[];
  locale: string;
  label: string;
  actionId: string;
  disabled?: boolean;
  size?: "xs" | "sm";
  variant?: "default" | "secondary" | "outline" | "ghost";
  className?: string;
  onSend: (terminalId?: string) => void;
};

export function AgentTargetPicker({
  targets,
  locale,
  label,
  actionId,
  disabled = false,
  size = "sm",
  variant = "outline",
  className,
  onSend,
}: AgentTargetPickerProps) {
  const ja = locale.startsWith("ja");
  const [open, setOpen] = useState(false);

  if (targets.length === 0) {
    const noTargetText = ja
      ? "送信先のCLIまたはTerminalがありません。"
      : "No target CLI or Terminal is available.";
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex" title={noTargetText}>
              <Button
                type="button"
                size={size}
                variant={variant}
                disabled
                data-iori-action={actionId}
                className={className}
              >
                <Send aria-hidden="true" />
                <span>{label}</span>
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>{noTargetText}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  if (targets.length === 1) {
    const only = targets[0]!;
    return (
      <Button
        type="button"
        size={size}
        variant={variant}
        disabled={disabled}
        data-iori-action={actionId}
        className={className}
        onClick={() => onSend(only.terminalId)}
      >
        <Send aria-hidden="true" />
        <span>{label}</span>
      </Button>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size={size}
          variant={variant}
          disabled={disabled}
          data-iori-action={actionId}
          className={className}
        >
          <Send aria-hidden="true" />
          <span>{label}</span>
          <ChevronDown aria-hidden="true" className="opacity-70" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 gap-1 p-1.5">
        <div className="px-2 py-1 text-2xs font-medium text-muted-foreground">
          {ja ? "送信先を選択" : "Select destination"}
        </div>
        <div className="flex flex-col gap-0.5">
          {targets.map((target) => (
            <button
              key={target.terminalId}
              type="button"
              data-iori-action="agent-target-option"
              data-terminal-id={target.terminalId}
              title={`${target.label}\n${target.worktreePath}`}
              className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-xs text-popover-foreground transition-colors outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground [@media(pointer:coarse)]:min-h-11"
              onClick={() => {
                setOpen(false);
                onSend(target.terminalId);
              }}
            >
              <span className="min-w-0 truncate">{target.label}</span>
              {target.isTeamParent ? (
                <Badge variant="secondary">Orchestrator</Badge>
              ) : target.cliName ? (
                <Badge variant="outline">{target.cliName}</Badge>
              ) : null}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
