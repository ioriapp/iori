import { useState } from "react";
import { Input } from "../components/ui/input.tsx";
import { Button } from "../components/ui/button.tsx";

export type SshPromptValue = {
  id: string;
  text: string;
  notification?: boolean;
};

export function SshPrompt({
  prompt,
  t,
  onAnswer,
  onCancel,
}: {
  prompt: SshPromptValue;
  t: (key: string) => string;
  onAnswer: (answer: string) => void;
  onCancel: (answer: string | null) => void;
}) {
  const [answer, setAnswer] = useState("");
  const yesNo = prompt.text.includes(
    "Are you sure you want to continue connecting",
  );
  return (
    <div className="connection-field" data-iori-state="ssh-prompt">
      <p className="ssh-prompt">{prompt.text}</p>
      {!yesNo && !prompt.notification && (
        <Input
          type="password"
          autoComplete="off"
          aria-label={t("SSH response")}
          data-iori-field="ssh-answer"
          value={answer}
          onChange={(event) => setAnswer(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onAnswer(answer);
            }
          }}
        />
      )}
      {!prompt.notification && (
        <div className="connection-actions">
          <Button
            type="button"
            data-iori-action="ssh-answer"
            onClick={() => onAnswer(yesNo ? "yes" : answer)}
          >
            {t(yesNo ? "Connect" : "Send")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onCancel(yesNo ? "no" : null)}
          >
            {t("Cancel setup")}
          </Button>
        </div>
      )}
    </div>
  );
}
