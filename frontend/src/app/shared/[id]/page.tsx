"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { viewSharedChat, type SharedChatView } from "@/lib/api";
import { MessageBubble } from "@/components/message-bubble";
import { Globe, Lock, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth-guard";

type PageState = "loading" | "ready" | "not_found" | "login_required";

export default function SharedChatPage() {
  const params = useParams();
  const shareId = params.id as string;
  const { requireAuth } = useAuth();

  const [state, setState] = useState<PageState>("loading");
  const [chat, setChat] = useState<SharedChatView | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await viewSharedChat(shareId);
        setChat(data);
        setState("ready");
      } catch (e) {
        if (e instanceof Error && e.message === "LOGIN_REQUIRED") {
          setState("login_required");
        } else {
          setState("not_found");
        }
      }
    };
    load();
  }, [shareId]);

  const handleLogin = async () => {
    const ok = await requireAuth();
    if (ok) {
      setState("loading");
      try {
        const data = await viewSharedChat(shareId);
        setChat(data);
        setState("ready");
      } catch {
        setState("not_found");
      }
    }
  };

  if (state === "loading") {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
      </div>
    );
  }

  if (state === "not_found") {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3">
        <AlertCircle className="h-12 w-12 text-muted-foreground" />
        <h1 className="text-xl font-semibold">Not found</h1>
        <p className="text-sm text-muted-foreground">
          This shared conversation doesn&apos;t exist or has been revoked.
        </p>
      </div>
    );
  }

  if (state === "login_required") {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3">
        <Lock className="h-12 w-12 text-muted-foreground" />
        <h1 className="text-xl font-semibold">Login required</h1>
        <p className="text-sm text-muted-foreground">
          You need to be logged in to view this conversation.
        </p>
        <Button onClick={handleLogin}>Sign in</Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      {/* Header */}
      <div className="mb-6 border-b pb-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
          {chat?.visibility === "public" ? (
            <Globe className="h-3.5 w-3.5" />
          ) : (
            <Lock className="h-3.5 w-3.5" />
          )}
          <span>Shared conversation</span>
        </div>
        <h1 className="text-xl font-semibold">{chat?.title || "Untitled"}</h1>
      </div>

      {/* Messages */}
      <div className="space-y-4">
        {chat?.messages.map((msg, i) => (
          <MessageBubble key={i} role={msg.role} content={msg.content} />
        ))}
      </div>
    </div>
  );
}
