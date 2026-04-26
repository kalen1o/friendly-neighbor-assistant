"use client";

import { forwardRef, useImperativeHandle, useMemo, useState, useRef, type KeyboardEvent } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { SendHorizonal, Square, Zap, Scale, Brain, Paperclip, X as XIcon } from "lucide-react";
import type { ChatMode } from "@/lib/api";
import { uploadChatFile } from "@/lib/api";
import { ModelPicker } from "@/components/model-picker";
import { SLASH_COMMANDS } from "@/lib/slash-commands";

const MODES: { value: ChatMode; label: string; icon: typeof Zap; description: string }[] = [
  { value: "fast", label: "Fast", icon: Zap, description: "Quick answers, fewer tools" },
  { value: "balanced", label: "Balanced", icon: Scale, description: "Default mode" },
  { value: "thinking", label: "Thinking", icon: Brain, description: "Deep research, more tools" },
];

export interface PendingFile {
  id: string;
  filename: string;
  file_type: string;
  previewUrl?: string;
}

interface ChatInputProps {
  onSend: (content: string, mode: ChatMode, files: PendingFile[]) => void;
  disabled: boolean;
  transparent?: boolean;
  chatModelId?: string | null;
  onModelChange?: (modelId: string | null) => void;
  onStop?: () => void;
}

export interface ChatInputHandle {
  setInput: (text: string, cursorOffset?: number) => void;
}

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(function ChatInput({ onSend, disabled, chatModelId, onModelChange, onStop }, ref) {
  const [value, setValue] = useState("");
  const [mode, setMode] = useState<ChatMode>("balanced");
  const [pendingFiles, setPendingFiles] = useState<
    { id: string; filename: string; file_type: string; previewUrl?: string }[]
  >([]);
  const [uploading, setUploading] = useState(false);
  const [selectedCmd, setSelectedCmd] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const commandMatches = useMemo(() => {
    const m = /^\/(\S*)$/.exec(value);
    if (!m) return null;
    const query = m[1].toLowerCase();
    const list = SLASH_COMMANDS.filter((c) => c.name.startsWith(query));
    return list.length > 0 ? list : null;
  }, [value]);

  // Clamp at access time so the selection stays in range when the match list
  // shrinks (e.g. user types another char that narrows the list).
  const effectiveSelected = commandMatches
    ? Math.min(selectedCmd, commandMatches.length - 1)
    : 0;

  const applyCommand = (name: string) => {
    const next = `/${name} `;
    setValue(next);
    setTimeout(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(next.length, next.length);
      }
    }, 0);
  };

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

  const handleFileSelect = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const uploaded = await uploadChatFile(file);
        const previewUrl = file.type.startsWith("image/")
          ? URL.createObjectURL(file)
          : undefined;
        setPendingFiles((prev) => [
          ...prev,
          {
            id: uploaded.id,
            filename: uploaded.filename,
            file_type: uploaded.file_type,
            previewUrl,
          },
        ]);
      }
    } catch {
      // ignore
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles: File[] = [];
    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      const dt = new DataTransfer();
      imageFiles.forEach((f) => dt.items.add(f));
      handleFileSelect(dt.files);
    }
  };

  const handleSend = () => {
    const trimmed = value.trim();
    if ((!trimmed && pendingFiles.length === 0) || disabled) return;
    onSend(trimmed, mode, pendingFiles);
    setValue("");
    pendingFiles.forEach((f) => { if (f.previewUrl) URL.revokeObjectURL(f.previewUrl); });
    setPendingFiles([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (commandMatches) {
      if (e.key === "Tab") {
        e.preventDefault();
        applyCommand(commandMatches[effectiveSelected].name);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedCmd((effectiveSelected + 1) % commandMatches.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedCmd((effectiveSelected - 1 + commandMatches.length) % commandMatches.length);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        applyCommand(commandMatches[effectiveSelected].name);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="sticky bottom-0 bg-background/95 backdrop-blur-sm px-2 py-3 md:relative md:bg-transparent md:backdrop-blur-none md:p-4">
      <div className="mx-auto max-w-3xl">
        {pendingFiles.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {pendingFiles.map((f) => (
              <div
                key={f.id}
                className="flex items-center gap-1.5 rounded-lg border bg-muted/30 px-2 py-1"
              >
                {f.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={f.previewUrl}
                    alt={f.filename}
                    className="h-8 w-8 rounded object-cover"
                  />
                ) : (
                  <Paperclip className="h-4 w-4 text-muted-foreground" />
                )}
                <span className="max-w-[120px] truncate text-xs">
                  {f.filename}
                </span>
                <button
                  onClick={() => {
                    if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
                    setPendingFiles((prev) => prev.filter((p) => p.id !== f.id));
                  }}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <XIcon className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        {commandMatches && (
          <div className="relative">
            <div className="absolute bottom-1 left-0 right-0 z-20 overflow-hidden rounded-xl border border-border/60 bg-popover shadow-lg">
              <div className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Commands — <kbd className="rounded bg-muted px-1 py-0.5 text-[10px] font-normal">Tab</kbd> to complete
              </div>
              {commandMatches.map((c, i) => (
                <button
                  key={c.name}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applyCommand(c.name);
                  }}
                  onMouseEnter={() => setSelectedCmd(i)}
                  className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors ${
                    i === effectiveSelected ? "bg-accent" : "hover:bg-accent/50"
                  }`}
                >
                  <span className="font-mono text-primary">/{c.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{c.description}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="flex items-center gap-2">
          <Textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="Type a message..."
            disabled={disabled}
            autoFocus
            rows={1}
            className="min-h-[44px] max-h-[200px] resize-none rounded-xl border-border/50 bg-muted/40 py-3 leading-[18px] transition-colors focus-visible:bg-background focus-visible:ring-primary/30"
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.pdf,.txt,.md"
            multiple
            className="hidden"
            onChange={(e) => handleFileSelect(e.target.files)}
          />
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 rounded-xl"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || uploading}
            title="Attach file"
          >
            <Paperclip className="h-4 w-4" />
          </Button>
          {disabled && onStop ? (
            <Button
              onClick={onStop}
              size="icon"
              variant="destructive"
              className="shrink-0 rounded-xl shadow-sm"
              title="Stop generating"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
            </Button>
          ) : (
            <Button
              onClick={handleSend}
              disabled={disabled || (!value.trim() && pendingFiles.length === 0)}
              size="icon"
              className="shrink-0 rounded-xl shadow-sm shadow-primary/20 transition-all hover:shadow-md hover:shadow-primary/25"
            >
              <SendHorizonal className="h-4 w-4" />
            </Button>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <ModelPicker
            selectedModelId={chatModelId ?? null}
            onSelect={(id) => onModelChange?.(id)}
          />
          <div className="mx-1 h-4 w-px bg-border/50" />
          {MODES.map((m) => {
            const Icon = m.icon;
            const isActive = mode === m.value;
            return (
              <button
                key={m.value}
                onClick={() => setMode(m.value)}
                title={m.description}
                className={`flex items-center gap-1 rounded-full px-3 py-2 text-[11px] md:text-[11px] md:px-2.5 md:py-1 font-medium transition-all ${
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
