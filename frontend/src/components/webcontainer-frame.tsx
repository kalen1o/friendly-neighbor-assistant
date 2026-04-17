"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

interface WebContainerFrameProps {
  files: Record<string, string>;
  dependencies: Record<string, string>;
  template: string;
  artifactId: string;
}

type PopupState = "closed" | "open" | "blocked";

export function WebContainerFrame({
  files,
  dependencies,
  template,
  artifactId,
}: WebContainerFrameProps) {
  const popupRef = useRef<Window | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const mountedRef = useRef(false);
  const [state, setState] = useState<PopupState>("closed");

  // Keep latest values in refs so channel handler can read current data
  const filesRef = useRef(files);
  const depsRef = useRef(dependencies);
  const templateRef = useRef(template);
  useEffect(() => {
    filesRef.current = files;
    depsRef.current = dependencies;
    templateRef.current = template;
  }, [files, dependencies, template]);

  // Sync file updates to open popup
  const prevFilesRef = useRef<string>("");
  useEffect(() => {
    if (!mountedRef.current || !channelRef.current) return;
    const snapshot = JSON.stringify(files);
    if (prevFilesRef.current && snapshot !== prevFilesRef.current) {
      const prev = JSON.parse(prevFilesRef.current) as Record<string, string>;
      for (const [path, code] of Object.entries(files)) {
        if (prev[path] !== code) {
          channelRef.current.postMessage({ type: "file-update", path, code });
        }
      }
    }
    prevFilesRef.current = snapshot;
  }, [files]);

  function teardown() {
    channelRef.current?.close();
    channelRef.current = null;
    if (popupRef.current && !popupRef.current.closed) {
      popupRef.current.close();
    }
    popupRef.current = null;
    mountedRef.current = false;
    prevFilesRef.current = "";
  }

  // Close popup when the artifact being previewed changes
  useEffect(() => {
    return () => {
      teardown();
      setState("closed");
    };
  }, [artifactId]);

  // Detect when user closes the popup manually
  useEffect(() => {
    if (state !== "open") return;
    const id = setInterval(() => {
      if (popupRef.current?.closed) {
        teardown();
        setState("closed");
      }
    }, 500);
    return () => clearInterval(id);
  }, [state]);

  function openPopup() {
    if (popupRef.current && !popupRef.current.closed) {
      popupRef.current.focus();
      return;
    }

    const channelName = `sandbox-${artifactId}`;
    const channel = new BroadcastChannel(channelName);
    channel.onmessage = (e) => {
      if (e.data?.type === "sandbox-ready" && !mountedRef.current) {
        mountedRef.current = true;
        channel.postMessage({
          type: "mount",
          files: filesRef.current,
          dependencies: depsRef.current,
          template: templateRef.current,
        });
      }
    };
    channelRef.current = channel;

    const url = `/sandbox?channel=${encodeURIComponent(channelName)}`;
    const w = window.open(url, channelName, "popup=yes,width=1100,height=800");
    if (!w) {
      channel.close();
      channelRef.current = null;
      setState("blocked");
      return;
    }
    popupRef.current = w;
    setState("open");
  }

  function openInNewTab() {
    const channelName = `sandbox-${artifactId}`;
    const channel = new BroadcastChannel(channelName);
    channel.onmessage = (e) => {
      if (e.data?.type === "sandbox-ready" && !mountedRef.current) {
        mountedRef.current = true;
        channel.postMessage({
          type: "mount",
          files: filesRef.current,
          dependencies: depsRef.current,
          template: templateRef.current,
        });
      }
    };
    channelRef.current = channel;

    const url = `/sandbox?channel=${encodeURIComponent(channelName)}`;
    const w = window.open(url, "_blank");
    if (!w) {
      channel.close();
      channelRef.current = null;
      setState("blocked");
      return;
    }
    popupRef.current = w;
    setState("open");
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      {state === "blocked" ? (
        <>
          <AlertCircle className="h-8 w-8 text-yellow-500" />
          <div className="text-sm font-medium">Popup blocked</div>
          <div className="max-w-sm text-xs text-muted-foreground">
            Allow popups for this site, or open the preview in a new tab.
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={openPopup}>
              Try again
            </Button>
            <Button size="sm" variant="outline" onClick={openInNewTab}>
              Open in new tab
            </Button>
          </div>
        </>
      ) : state === "open" ? (
        <>
          <ExternalLink className="h-6 w-6 text-muted-foreground" />
          <div className="text-sm">Preview running in a separate window.</div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => popupRef.current?.focus()}
            >
              Focus window
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                teardown();
                setState("closed");
              }}
            >
              Close
            </Button>
          </div>
        </>
      ) : (
        <>
          <ExternalLink className="h-8 w-8 text-muted-foreground" />
          <div className="text-sm font-medium">Preview opens in a popup</div>
          <div className="max-w-sm text-xs text-muted-foreground">
            WebContainer needs an isolated window. Click below to launch the preview.
          </div>
          <Button size="sm" onClick={openPopup}>
            Open preview
          </Button>
        </>
      )}
    </div>
  );
}
