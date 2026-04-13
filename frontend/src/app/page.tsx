"use client";

import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-guard";
import { EmptyState } from "@/components/chat-messages";
import { ChatInput, type ChatInputHandle } from "@/components/chat-input";
import { createChat, type ChatMode } from "@/lib/api";
import { useRef } from "react";
import { toast } from "sonner";

export default function Home() {
  const router = useRouter();
  const { requireAuth } = useAuth();
  const chatInputRef = useRef<ChatInputHandle>(null);

  const handleSend = async (content: string, mode: ChatMode = "balanced") => {
    const authed = await requireAuth();
    if (!authed) {
      chatInputRef.current?.setInput(content);
      return;
    }
    try {
      const chat = await createChat();
      router.push(`/chat/${chat.id}?q=${encodeURIComponent(content)}&mode=${mode}`);
    } catch {
      toast.error("Failed to create chat");
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Top spacer */}
      <div className="flex-1" />

      {/* Centered content */}
      <div className="flex justify-center overflow-hidden">
        <EmptyState onSuggestionClick={(text, cur) => chatInputRef.current?.setInput(text, cur)} />
      </div>

      <div className="pt-6">
        <ChatInput ref={chatInputRef} onSend={handleSend} disabled={false} transparent />
      </div>

      {/* Bottom spacer */}
      <div className="flex-1" />
    </div>
  );
}
