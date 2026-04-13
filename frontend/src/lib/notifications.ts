/**
 * Browser Notifications helper.
 * Preferences stored in localStorage — no backend needed.
 */

const KEY_ENABLED = "notifications-enabled";
const KEY_PREVIEW = "notifications-preview";

export function isNotificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function getNotificationPrefs(): {
  enabled: boolean;
  preview: boolean;
} {
  if (typeof window === "undefined") return { enabled: false, preview: false };
  return {
    enabled: localStorage.getItem(KEY_ENABLED) === "true",
    preview: localStorage.getItem(KEY_PREVIEW) !== "false", // default true
  };
}

export function setNotificationEnabled(enabled: boolean): void {
  localStorage.setItem(KEY_ENABLED, String(enabled));
}

export function setNotificationPreview(preview: boolean): void {
  localStorage.setItem(KEY_PREVIEW, String(preview));
}

export async function requestPermission(): Promise<boolean> {
  if (!isNotificationsSupported()) return false;
  const result = await Notification.requestPermission();
  return result === "granted";
}

export function getPermissionState(): NotificationPermission | "unsupported" {
  if (!isNotificationsSupported()) return "unsupported";
  return Notification.permission;
}

export function showChatNotification(
  chatTitle: string,
  responseText: string,
  chatId: string
): void {
  const prefs = getNotificationPrefs();
  if (!prefs.enabled) return;
  if (!isNotificationsSupported()) return;
  if (Notification.permission !== "granted") return;

  // Check if user is on a different page or tab is hidden
  const isOnThisChat =
    !document.hidden && window.location.pathname === `/chat/${chatId}`;
  if (isOnThisChat) return;

  const title = chatTitle || "Friendly Neighbor";
  const body = prefs.preview
    ? responseText.slice(0, 100) + (responseText.length > 100 ? "..." : "")
    : "Response ready";

  const notification = new Notification(title, {
    body,
    icon: "/small-logo.png",
    tag: `chat-${chatId}`, // replaces previous notification for same chat
  });

  notification.onclick = () => {
    window.focus();
    // Use pushState + dispatch event for soft navigation (avoids full reload + CORS issues)
    if (window.location.pathname !== `/chat/${chatId}`) {
      window.dispatchEvent(
        new CustomEvent("notification-navigate", { detail: { chatId } })
      );
    }
    notification.close();
  };
}
