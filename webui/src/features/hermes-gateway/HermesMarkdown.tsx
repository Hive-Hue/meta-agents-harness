import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Icon } from "../../components/ui/Icon";

type HermesMarkdownProps = {
  content: string;
};

type MarkdownCodeProps = React.HTMLAttributes<HTMLElement> & {
  inline?: boolean;
  className?: string;
  children?: ReactNode;
};

type MarkdownLinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  children?: ReactNode;
};

function nodeToText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") {
    return String(node);
  }
  if (Array.isArray(node)) return node.map((item) => nodeToText(item)).join("");
  if (node && typeof node === "object" && "props" in node) {
    const props = (node as { props?: { children?: ReactNode } }).props;
    return nodeToText(props?.children ?? "");
  }
  return "";
}

function MarkdownCode({ inline, className, children, ...props }: MarkdownCodeProps) {
  const language = useMemo(() => {
    const match = `${className || ""}`.match(/language-([a-z0-9_+-]+)/i);
    return `${match?.[1] || ""}`.toLowerCase();
  }, [className]);
  const codeText = useMemo(() => nodeToText(children).replace(/\n$/, ""), [children]);
  const [copied, setCopied] = useState(false);

  const copyCode = async () => {
    if (!codeText.trim()) return;
    try {
      await navigator.clipboard.writeText(codeText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  if (inline) {
    return (
      <code className="hermes-md__inline-code" {...props}>
        {children}
      </code>
    );
  }

  const languageLabel = language ? language.toUpperCase() : "CODE";

  return (
    <div className="hermes-md__codeblock">
      <div className="hermes-md__codehead">
        <span>{languageLabel}</span>
        <button type="button" className={`hermes-md__copy ${copied ? "is-copied" : ""}`} onClick={() => void copyCode()}>
          <Icon name={copied ? "check" : "content_copy"} size={13} />
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="hermes-md__pre">
        <code className={className} {...props}>
          {children}
        </code>
      </pre>
    </div>
  );
}

export function HermesMarkdown({ content }: HermesMarkdownProps) {
  const components: Components = {
    code: ({ node: _node, ...props }) => <MarkdownCode {...(props as MarkdownCodeProps)} />,
    a: ({ node: _node, children, href, ...props }) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        {...(props as MarkdownLinkProps)}
      >
        {children}
      </a>
    ),
    table: ({ node: _node, children, ...props }) => (
      <div className="hermes-md__table-wrap">
        <table {...props}>{children}</table>
      </div>
    ),
  };

  return (
    <div className="hermes-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
