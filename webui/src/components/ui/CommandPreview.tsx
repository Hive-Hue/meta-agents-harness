import { Icon } from "./Icon";
import { useState } from "react";

type CommandPreviewProps = {
  context: string;
  command: string;
};

export function CommandPreview({ context, command }: CommandPreviewProps) {
  const [copied, setCopied] = useState(false);

  const copyCommand = async () => {
    const text = `${command}`;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const input = document.createElement("textarea");
        input.value = text;
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.appendChild(input);
        input.focus();
        input.select();
        document.execCommand("copy");
        document.body.removeChild(input);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="command-preview" aria-label="Command preview">
      <div className="command-preview__context">
        <span className="command-preview__label">Context</span>
        <span className="command-preview__value">{context}</span>
      </div>
      <div className="command-preview__command">
        <code>$ {command}</code>
        <button className="command-preview__copy" type="button" aria-label="Copy CLI command" onClick={copyCommand}>
          <Icon name={copied ? "check" : "content_copy"} size={16} />
          <span className="sr-only">{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
    </section>
  );
}
