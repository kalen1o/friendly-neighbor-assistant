"use client";

import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Copy, Check, Pencil, X, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SourceAttribution } from "@/components/source-attribution";
import type { Source, MessageMetrics } from "@/lib/api";

interface MessageBubbleProps {
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  sources?: Source[] | null;
  metrics?: MessageMetrics | null;
  onEdit?: (newContent: string) => void;
}

export function MessageBubble({ role, content, isStreaming, sources, metrics, onEdit }: MessageBubbleProps) {
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
      <div className="group flex min-w-0 max-w-[80%] flex-col gap-1">
        <div
          className={cn(
            "rounded-[20px] px-4 py-3 text-sm",
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
            <p className="whitespace-pre-wrap">{content}</p>
          ) : (
            <div className="prose prose-sm dark:prose-invert max-w-none overflow-hidden [&_pre]:overflow-x-auto [&_pre]:whitespace-pre-wrap [&_pre]:break-words">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {isStreaming ? content + " \u258D" : content}
              </ReactMarkdown>
            </div>
          )}
        </div>
        {isUser && !isEditing && (
          <div className="flex justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
              onClick={handleCopy}
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            </Button>
            {onEdit && (
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
        {!isUser && (sources?.length || metrics) && (
          <SourceAttribution sources={sources || []} metrics={metrics} />
        )}
      </div>
    </div>
  );
}
