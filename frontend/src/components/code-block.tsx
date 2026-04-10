"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

interface CodeBlockProps {
  language?: string;
  children: string;
}

export function CodeBlock({ language, children }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="group/code relative my-3 overflow-hidden rounded-lg border border-border/40 bg-[#282c34]">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-1.5">
        <span className="text-[11px] font-medium text-white/40">
          {language || "text"}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-white/40 transition-colors hover:bg-white/10 hover:text-white/70"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              Copy
            </>
          )}
        </button>
      </div>
      <SyntaxHighlighter
        language={language || "text"}
        style={oneDark}
        customStyle={{
          margin: 0,
          padding: "1rem",
          background: "transparent",
          fontSize: "0.8125rem",
          lineHeight: "1.6",
        }}
        codeTagProps={{
          style: { fontFamily: "var(--font-mono, ui-monospace, monospace)" },
        }}
      >
        {children}
      </SyntaxHighlighter>
    </div>
  );
}

export function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded-md bg-muted px-1.5 py-0.5 text-[0.8125rem] font-medium text-foreground">
      {children}
    </code>
  );
}
