"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Clock, Coins, FileText, Globe, Wrench } from "lucide-react";
import type { Source, MessageMetrics } from "@/lib/api";

interface SourceAttributionProps {
  sources: Source[];
  metrics?: MessageMetrics | null;
  messageId?: string;
}

export function SourceAttribution({ sources, metrics, messageId }: SourceAttributionProps) {
  const [isOpen, setIsOpen] = useState(false);

  const hasSources = sources && sources.length > 0;
  if (!hasSources && !metrics) return null;

  return (
    <div className="ml-1">
      <div className="flex items-center gap-2">
        {hasSources && (
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="flex items-center gap-1 rounded-full border border-border/50 bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {isOpen ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            {sources.length} {sources.length === 1 ? "source" : "sources"}
          </button>
        )}
        {metrics && (
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60">
            {metrics.latency !== undefined && (
              <span className="flex items-center gap-0.5">
                <Clock className="h-2.5 w-2.5" />
                {metrics.latency}s
              </span>
            )}
            {metrics.tokens_total !== undefined && (
              <span className="flex items-center gap-0.5">
                <Coins className="h-2.5 w-2.5" />
                {metrics.tokens_input}+{metrics.tokens_output}={metrics.tokens_total}
              </span>
            )}
          </div>
        )}
      </div>
      {isOpen && (
        <div className="mt-1.5 flex flex-col gap-1.5 pl-1 animate-in fade-in slide-in-from-top-1 duration-200">
          {sources.map((source, i) => (
            <div
              key={i}
              id={`${messageId || "msg"}-source-${source.citation_index ?? i + 1}`}
              className="flex items-start gap-2 rounded-lg border border-border/40 bg-muted/30 px-2.5 py-2 text-xs transition-all duration-300"
            >
              {source.type === "document" ? (
                <>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {source.citation_index != null && (
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                        {source.citation_index}
                      </span>
                    )}
                    <FileText className="h-3.5 w-3.5 text-primary/70" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="max-w-[220px] font-medium truncate" title={source.filename}>{source.filename}</span>
                      {(() => {
                        const s = source.relevance_score ?? source.score;
                        return s !== undefined && s > 0.1 ? (
                          <span className="rounded bg-primary/5 px-1 py-0.5 text-[10px] text-muted-foreground/60">
                            {Math.round(s * 100)}%
                          </span>
                        ) : null;
                      })()}
                    </div>
                    {source.chunk_excerpt && (
                      <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground/70 line-clamp-2">
                        {source.chunk_excerpt}
                      </p>
                    )}
                  </div>
                </>
              ) : source.type === "skill" ? (
                <div className="flex items-center gap-1.5">
                  <Wrench className="h-3 w-3 shrink-0 text-primary/70" />
                  <span className="truncate">{source.tool?.replace(/_/g, " ") || "skill"}</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 min-w-0">
                  <Globe className="h-3 w-3 shrink-0 text-primary/70" />
                  {source.url ? (
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="truncate hover:underline"
                    >
                      {source.title || source.url}
                    </a>
                  ) : (
                    <span className="truncate">{source.title}</span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
