import { Icon } from "./Icon";

type CommandPreviewProps = {
  context: string;
  command: string;
};

export function CommandPreview({ context, command }: CommandPreviewProps) {
  return (
    <section className="command-preview" aria-label="Command preview">
      <div className="command-preview__context">
        <span className="command-preview__label">Context</span>
        <span className="command-preview__value">{context}</span>
      </div>
      <div className="command-preview__command">
        <code>$ {command}</code>
        <button className="command-preview__copy" type="button" aria-label="Copy CLI command">
          <Icon name="content_copy" size={16} />
          <span className="sr-only">Copy</span>
        </button>
      </div>
    </section>
  );
}
