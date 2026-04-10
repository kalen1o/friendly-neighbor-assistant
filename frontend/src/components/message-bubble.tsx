"use client";

import { useState, useRef, useEffect } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Copy, Check, Pencil, X, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SourceAttribution } from "@/components/source-attribution";
import { CodeBlock, InlineCode } from "@/components/code-block";
import { processChildren, enrichText } from "@/components/rich-text";
import type { Source, MessageMetrics } from "@/lib/api";

interface AttachedFile {
  url: string;
  name: string;
  type: string;
}

interface MessageBubbleProps {
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  sources?: Source[] | null;
  metrics?: MessageMetrics | null;
  onEdit?: (newContent: string) => void;
  files?: AttachedFile[];
}

const mdComponents: Components = {
  // Code blocks with syntax highlighting + copy
  code({ className, children, ...props }) {
    const match = /language-(\w+)/.exec(className || "");
    const text = String(children).replace(/\n$/, "");
    // Fenced code block (has language class or is multi-line)
    if (match || text.includes("\n")) {
      return <CodeBlock language={match?.[1]}>{text}</CodeBlock>;
    }
    // Inline code
    return <InlineCode>{children}</InlineCode>;
  },
  // Don't wrap code blocks in <pre> since CodeBlock handles it
  pre({ children }) {
    return <>{children}</>;
  },
  // Paragraphs with proper spacing + color swatches
  p({ children }) {
    return <p className="mb-3 last:mb-0">{processChildren(children)}</p>;
  },
  // Headers
  h1({ children }) {
    return <h1 className="mb-3 mt-5 text-lg font-bold first:mt-0">{children}</h1>;
  },
  h2({ children }) {
    return <h2 className="mb-2 mt-4 text-base font-bold first:mt-0">{children}</h2>;
  },
  h3({ children }) {
    return <h3 className="mb-2 mt-3 text-sm font-bold first:mt-0">{children}</h3>;
  },
  // Lists
  ul({ children }) {
    return <ul className="mb-3 ml-4 list-disc space-y-1 last:mb-0 [&_ul]:mb-0 [&_ul]:mt-1">{children}</ul>;
  },
  ol({ children }) {
    return <ol className="mb-3 ml-4 list-decimal space-y-1 last:mb-0 [&_ol]:mb-0 [&_ol]:mt-1">{children}</ol>;
  },
  li({ children }) {
    return <li className="pl-0.5">{processChildren(children)}</li>;
  },
  // Blockquotes
  blockquote({ children }) {
    return (
      <blockquote className="my-3 border-l-2 border-primary/40 pl-3 italic text-muted-foreground">
        {children}
      </blockquote>
    );
  },
  // Tables
  table({ children }) {
    return (
      <div className="my-3 overflow-x-auto rounded-lg border border-border/40">
        <table className="w-full text-sm">{children}</table>
      </div>
    );
  },
  thead({ children }) {
    return <thead className="border-b border-border/40 bg-muted/50">{children}</thead>;
  },
  th({ children }) {
    return <th className="px-3 py-2 text-left text-xs font-semibold">{children}</th>;
  },
  td({ children }) {
    return <td className="border-t border-border/20 px-3 py-2">{processChildren(children)}</td>;
  },
  // Horizontal rule
  hr() {
    return <hr className="my-4 border-border/40" />;
  },
  // Links
  a({ href, children }) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary/60">
        {children}
      </a>
    );
  },
  // Strong / emphasis
  strong({ children }) {
    return <strong className="font-semibold">{children}</strong>;
  },
};

export function MessageBubble({ role, content, isStreaming, sources, metrics, onEdit, files }: MessageBubbleProps) {
  const isUser = role === "user";
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(content);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      const ta = textareaRef.current;
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }
  }, [isEditing]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleEditSubmit = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== content && onEdit) {
      onEdit(trimmed);
    }
    setIsEditing(false);
  };

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleEditSubmit();
    }
    if (e.key === "Escape") {
      setEditValue(content);
      setIsEditing(false);
    }
  };

  return (
    <div
      className={cn(
        "flex w-full animate-fade-in-up",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      <div className="group flex min-w-0 max-w-[90%] md:max-w-[80%] flex-col gap-1">
        <div
          className={cn(
            "rounded-[20px] px-3 py-2 md:px-4 md:py-3 text-sm",
            isUser
              ? "rounded-br-md bg-primary text-primary-foreground shadow-sm shadow-primary/20"
              : "rounded-bl-md border border-border/60 bg-card shadow-sm"
          )}
        >
          {isUser && isEditing ? (
            <div className="flex flex-col gap-2">
              <Textarea
                ref={textareaRef}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={handleEditKeyDown}
                rows={2}
                className="min-h-0 resize-none border-primary-foreground/30 bg-primary-foreground/10 text-sm text-primary-foreground placeholder:text-primary-foreground/50"
              />
              <div className="flex justify-end gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-primary-foreground/70 hover:bg-primary-foreground/10 hover:text-primary-foreground"
                  onClick={() => { setEditValue(content); setIsEditing(false); }}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-primary-foreground/70 hover:bg-primary-foreground/10 hover:text-primary-foreground"
                  onClick={handleEditSubmit}
                >
                  <Send className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ) : isUser ? (
            <>
              {files && files.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-2">
                  {files.map((f, i) =>
                    f.type.startsWith("image/") ? (
                      <img
                        key={i}
                        src={f.url}
                        alt={f.name}
                        className="max-h-48 max-w-full rounded-lg object-contain"
                      />
                    ) : (
                      <a
                        key={i}
                        href={f.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 rounded-lg bg-primary-foreground/10 px-3 py-1.5 text-xs text-primary-foreground/80 hover:text-primary-foreground"
                      >
                        <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                        </svg>
                        {f.name}
                      </a>
                    )
                  )}
                </div>
              )}
              <p className="whitespace-pre-wrap">{content}</p>
            </>
          ) : isStreaming ? (
            <div className="max-w-none overflow-hidden text-sm leading-relaxed">
              <p className="whitespace-pre-wrap">{enrichText(content)}<span className="streaming-cursor" /></p>
            </div>
          ) : (
            <div className="max-w-none overflow-hidden text-sm leading-relaxed">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                {content}
              </ReactMarkdown>
            </div>
          )}
        </div>
        {!isUser && (sources?.length || metrics) ? (
          <div className="flex items-center justify-between gap-1">
            <SourceAttribution sources={sources || []} metrics={metrics} />
            {!isEditing && (
              <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-foreground"
                  onClick={handleCopy}
                >
                  {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                </Button>
              </div>
            )}
          </div>
        ) : !isEditing && (
          <div className={cn(
            "flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100",
            isUser ? "justify-end" : "justify-start pl-1"
          )}>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
              onClick={handleCopy}
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            </Button>
            {isUser && onEdit && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                onClick={() => { setEditValue(content); setIsEditing(true); }}
              >
                <Pencil className="h-3 w-3" />
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
