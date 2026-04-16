"use client";

import { useEffect, useRef } from "react";

interface WebContainerFrameProps {
  files: Record<string, string>;
  dependencies: Record<string, string>;
  template: string;
  artifactId: string;
}

export function WebContainerFrame({
  files,
  dependencies,
  template,
  artifactId,
}: WebContainerFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const mountedRef = useRef(false);

  // Send mount message once iframe is ready.
  // Use a small delay after onLoad to ensure the sandbox page's
  // message listener is registered before we post.
  const handleIframeLoad = () => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    setTimeout(() => {
      iframeRef.current?.contentWindow?.postMessage(
        { type: "mount", files, dependencies, template },
        "*",
      );
    }, 100);
  };

  // Send file updates when files change (after initial mount)
  const prevFilesRef = useRef<string>("");
  useEffect(() => {
    if (!mountedRef.current) return;
    const snapshot = JSON.stringify(files);
    if (prevFilesRef.current && snapshot !== prevFilesRef.current) {
      const prev = JSON.parse(prevFilesRef.current) as Record<string, string>;
      for (const [path, code] of Object.entries(files)) {
        if (prev[path] !== code) {
          iframeRef.current?.contentWindow?.postMessage(
            { type: "file-update", path, code },
            "*",
          );
        }
      }
    }
    prevFilesRef.current = snapshot;
  }, [files]);

  return (
    <iframe
      ref={iframeRef}
      src="/sandbox"
      className="h-full w-full border-0"
      title="WebContainer Sandbox"
      onLoad={handleIframeLoad}
      allow="cross-origin-isolated"
      key={artifactId}
    />
  );
}
