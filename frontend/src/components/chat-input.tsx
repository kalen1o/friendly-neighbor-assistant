"use client";

import { forwardRef, useImperativeHandle, useState, useRef, type KeyboardEvent } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { SendHorizonal, Zap, Scale, Brain } from "lucide-react";
import type { ChatMode } from "@/lib/api";

const MODES: { value: ChatMode; label: string; icon: typeof Zap; description: string }[] = [
  { value: "fast", label: "Fast", icon: Zap, description: "Quick answers, fewer tools" },
  { value: "balanced", label: "Balanced", icon: Scale, description: "Default mode" },
  { value: "thinking", label: "Thinking", icon: Brain, description: "Deep research, more tools" },
];

interface ChatInputProps {
  onSend: (content: string, mode: ChatMode) => void;
  disabled: boolean;
  transparent?: boolean;
}

export interface ChatInputHandle {
  setInput: (text: string, cursorOffset?: number) => void;
}

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(function ChatInput({ onSend, disabled, transparent }, ref) {
  const [value, setValue] = useState("");
  const [mode, setMode] = useState<ChatMode>("balanced");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(ref, () => ({
    setInput(text: string, cursorOffset?: number) {
      setValue(text);
      setTimeout(() => {
        const ta = textareaRef.current;
        if (ta) {
          ta.focus();
          const pos = cursorOffset ?? text.length;
          ta.setSelectionRange(pos, pos);
        }
      }, 0);
    },
  }));

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed, mode);
    setValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className={`px-2 py-3 md:p-4 transition-[background-color,border-color,backdrop-filter] duration-500 ${transparent ? "border-t border-transparent" : "border-t border-border/60 bg-card/80 backdrop-blur-sm"}`}>
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center gap-2">
          <Textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            disabled={disabled}
            autoFocus
            rows={1}
            className="min-h-[44px] max-h-[200px] resize-none rounded-xl border-border/50 bg-muted/40 py-3 leading-[18px] transition-colors focus-visible:bg-background focus-visible:ring-primary/30"
          />
          <Button
            onClick={handleSend}
            disabled={disabled || !value.trim()}
            size="icon"
            className="shrink-0 rounded-xl shadow-sm shadow-primary/20 transition-all hover:shadow-md hover:shadow-primary/25"
          >
            <SendHorizonal className="h-4 w-4" />
          </Button>
        </div>
        <div className="mt-2 flex items-center gap-1">
          {MODES.map((m) => {
            const Icon = m.icon;
            const isActive = mode === m.value;
            return (
              <button
                key={m.value}
                onClick={() => setMode(m.value)}
                title={m.description}
                className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-all ${
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground/60 hover:text-muted-foreground"
                }`}
              >
                <Icon className="h-3 w-3" />
                {m.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
});
