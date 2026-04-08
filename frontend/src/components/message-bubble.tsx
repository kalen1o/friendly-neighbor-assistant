import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { SourceAttribution } from "@/components/source-attribution";
import type { Source } from "@/lib/api";

interface MessageBubbleProps {
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  sources?: Source[] | null;
}

export function MessageBubble({ role, content, isStreaming, sources }: MessageBubbleProps) {
  const isUser = role === "user";

  return (
    <div
      className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}
    >
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-4 py-3 text-sm",
          isUser
            ? "bg-primary text-primary-foreground rounded-br-md"
            : "bg-muted rounded-bl-md"
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{content}</p>
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {isStreaming ? content + " ▍" : content}
            </ReactMarkdown>
          </div>
        )}
      </div>
        {!isUser && sources && sources.length > 0 && (
          <SourceAttribution sources={sources} />
        )}
    </div>
  );
}
