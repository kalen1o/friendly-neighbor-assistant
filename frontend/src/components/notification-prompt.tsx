"use client";

import { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { UserInfo } from "@/lib/api";
import {
  isNotificationsSupported,
  requestPermission,
  setNotificationEnabled,
  setNotificationPreview,
  getPermissionState,
} from "@/lib/notifications";

const PROMPTED_KEY = "notifications-prompted";

interface NotificationPromptProps {
  user: UserInfo | null;
}

export function NotificationPrompt({ user }: NotificationPromptProps) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!user) return;
    if (!isNotificationsSupported()) return;
    if (getPermissionState() !== "default") return; // already granted or denied
    if (localStorage.getItem(PROMPTED_KEY)) return; // already asked

    // Show prompt after a short delay so it doesn't feel jarring
    const timer = setTimeout(() => setShow(true), 2000);
    return () => clearTimeout(timer);
  }, [user]);

  const handleEnable = async () => {
    localStorage.setItem(PROMPTED_KEY, "true");
    const granted = await requestPermission();
    if (granted) {
      setNotificationEnabled(true);
      setNotificationPreview(true);
    }
    setShow(false);
  };

  const handleDismiss = () => {
    localStorage.setItem(PROMPTED_KEY, "true");
    setShow(false);
  };

  if (!show) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 animate-message-in">
      <div className="flex max-w-sm items-start gap-3 rounded-xl border bg-background p-4 shadow-lg">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-500/10">
          <Bell className="h-5 w-5 text-blue-500" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium">Enable notifications?</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Get notified when a response is ready while you're on another tab or chat.
          </p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={handleEnable}>
              Enable
            </Button>
            <Button size="sm" variant="ghost" onClick={handleDismiss}>
              No thanks
            </Button>
          </div>
        </div>
        <button
          onClick={handleDismiss}
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
