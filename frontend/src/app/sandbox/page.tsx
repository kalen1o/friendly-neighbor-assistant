"use client";

import { useEffect, useRef, useState } from "react";
import { WebContainer, type FileSystemTree } from "@webcontainer/api";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

type Phase = "waiting" | "booting" | "installing" | "starting" | "ready" | "error";

function getStartCommand(template: string, files: Record<string, string>): string[] {
  if (template === "nextjs") return ["npx", "next", "dev", "--port", "3111"];
  if (template === "vite") return ["npx", "vite", "--port", "3111", "--host"];

  // node-server: find the actual entry file
  const paths = Object.keys(files);
  const entry =
    paths.find((p) => p === "/server.ts") ||
    paths.find((p) => p === "/server.js") ||
    paths.find((p) => p === "/index.ts") ||
    paths.find((p) => p === "/index.js") ||
    paths.find((p) => p === "/app.ts") ||
    paths.find((p) => p === "/app.js");

  const file = entry?.replace(/^\//, "") ?? "server.js";

  // TypeScript files need npx tsx
  if (file.endsWith(".ts")) return ["npx", "tsx", file];
  return ["node", file];
}

function toWebContainerFiles(files: Record<string, string>): FileSystemTree {
  const result: FileSystemTree = {};
  for (const [path, contents] of Object.entries(files)) {
    const parts = path.replace(/^\//, "").split("/");
    let current: FileSystemTree = result;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!current[parts[i]]) {
        current[parts[i]] = { directory: {} };
      }
      current = (current[parts[i]] as { directory: FileSystemTree }).directory;
    }
    current[parts[parts.length - 1]] = { file: { contents } };
  }
  return result;
}

export default function SandboxPage() {
  const terminalRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLIFrameElement>(null);
  const wcRef = useRef<WebContainer | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const processRef = useRef<{ kill: () => void } | null>(null);
  const shellWriterRef = useRef<WritableStreamDefaultWriter | null>(null);
  const [phase, setPhase] = useState<Phase>("waiting");
  const [statusMessage, setStatusMessage] = useState("Waiting for files...");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [currentTemplate, setCurrentTemplate] = useState<string>("");

  function sendStatus(p: Phase, msg: string) {
    setPhase(p);
    setStatusMessage(msg);
    window.parent.postMessage({ type: "status", phase: p, message: msg }, "*");
  }

  useEffect(() => {
    if (!terminalRef.current || termRef.current) return;
    const term = new Terminal({ convertEol: true, fontSize: 13, theme: { background: "#1e1e1e" } });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    fitAddon.fit();
    termRef.current = term;

    // Forward keyboard input to the active shell
    term.onData((data) => {
      shellWriterRef.current?.write(data);
    });

    const resizeObserver = new ResizeObserver(() => fitAddon.fit());
    resizeObserver.observe(terminalRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    async function handleMessage(event: MessageEvent) {
      const { data } = event;
      if (!data?.type) return;

      if (data.type === "mount") {
        setCurrentTemplate(data.template);
        await bootAndRun(data.files, data.dependencies, data.template);
      } else if (data.type === "file-update" && wcRef.current) {
        const filePath = data.path.replace(/^\//, "");
        await wcRef.current.fs.writeFile(filePath, data.code);
      } else if (data.type === "restart") {
        if (processRef.current) processRef.current.kill();
        if (wcRef.current && data.template) {
          const cmd = getStartCommand(data.template, data.files || {});
          await spawnProcess(cmd);
        }
      }
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  async function spawnProcess(cmd: string[]) {
    if (!wcRef.current || !termRef.current) return;
    const process = await wcRef.current.spawn(cmd[0], cmd.slice(1));
    processRef.current = process;
    process.output.pipeTo(
      new WritableStream({
        write(chunk) {
          termRef.current?.write(chunk);
        },
      }),
    );
    return process;
  }

  async function startShell() {
    if (!wcRef.current || !termRef.current) return;
    const shell = await wcRef.current.spawn("jsh", {
      terminal: { cols: termRef.current.cols, rows: termRef.current.rows },
    });
    shell.output.pipeTo(
      new WritableStream({
        write(chunk) {
          termRef.current?.write(chunk);
        },
      }),
    );
    shellWriterRef.current = shell.input.getWriter();
  }

  function ensureViteFiles(files: Record<string, string>, deps: Record<string, string>) {
    const patched = { ...files };
    const patchedDeps = { ...deps };

    // Ensure vite.config exists
    if (!Object.keys(patched).some((p) => p.includes("vite.config"))) {
      const hasTs = Object.keys(patched).some((p) => p.endsWith(".tsx") || p.endsWith(".ts"));
      patched[hasTs ? "/vite.config.ts" : "/vite.config.js"] =
        "import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\n\nexport default defineConfig({\n  plugins: [react()],\n});\n";
    }

    // Ensure index.html exists
    if (!patched["/index.html"]) {
      patched["/index.html"] =
        '<!DOCTYPE html>\n<html lang="en">\n<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>App</title></head>\n<body>\n<div id="root"></div>\n<script type="module" src="/src/main.tsx"></script>\n</body>\n</html>\n';
    }

    // Ensure src/main.tsx exists
    if (!patched["/src/main.tsx"] && !patched["/src/main.jsx"] && !patched["/src/main.ts"] && !patched["/src/main.js"]) {
      // Find the app component
      const appFile = Object.keys(patched).find((p) => /\/(App)\.(tsx|jsx|ts|js)$/.test(p));
      const appImport = appFile ? appFile.replace(/^\//, "./").replace(/\.(tsx|jsx|ts|js)$/, "") : "./App";
      patched["/src/main.tsx"] =
        `import React from 'react';\nimport ReactDOM from 'react-dom/client';\nimport App from '${appImport}';\n\nReactDOM.createRoot(document.getElementById('root')!).render(\n  <React.StrictMode>\n    <App />\n  </React.StrictMode>\n);\n`;

      // If App.tsx is at root, move it to /src/
      if (patched["/App.tsx"] && !patched["/src/App.tsx"]) {
        patched["/src/App.tsx"] = patched["/App.tsx"];
        delete patched["/App.tsx"];
        patched["/src/main.tsx"] = patched["/src/main.tsx"].replace(appImport, "./App");
      }
    }

    // Ensure required deps
    if (!patchedDeps["vite"]) patchedDeps["vite"] = "latest";
    if (!patchedDeps["@vitejs/plugin-react"]) patchedDeps["@vitejs/plugin-react"] = "latest";

    return { files: patched, deps: patchedDeps };
  }

  async function bootAndRun(
    files: Record<string, string>,
    dependencies: Record<string, string>,
    template: string,
  ) {
    const term = termRef.current;
    if (!term) return;

    try {
      sendStatus("booting", "Booting WebContainer...");
      term.writeln("\x1b[36m▸ Booting WebContainer...\x1b[0m");
      if (!wcRef.current) {
        wcRef.current = await WebContainer.boot();
      }
      const wc = wcRef.current;

      wc.on("server-ready", (_port: number, url: string) => {
        console.log("[sandbox] server-ready event: port=", _port, "url=", url);
        setPreviewUrl(url);
        sendStatus("ready", "Dev server ready");
        window.parent.postMessage({ type: "preview-url", url }, "*");
      });

      // Patch files/deps based on template
      let mountFiles = files;
      let allDeps = { ...dependencies };

      if (template === "vite") {
        const patched = ensureViteFiles(files, dependencies);
        mountFiles = patched.files;
        allDeps = patched.deps;
      }

      // Auto-add tsx if node-server has TypeScript entry files
      if (template === "node-server") {
        const needsTsx = Object.keys(mountFiles).some((p) => /^\/(server|index|app)\.ts$/.test(p));
        if (needsTsx && !allDeps["tsx"]) allDeps["tsx"] = "latest";
      }

      const wcFiles = toWebContainerFiles(mountFiles);

      // Use LLM's package.json if provided, otherwise generate one
      if (!mountFiles["/package.json"]) {
        const packageJson = JSON.stringify(
          { name: "sandbox-project", private: true, dependencies: allDeps },
          null,
          2,
        );
        wcFiles["package.json"] = { file: { contents: packageJson } };
      } else {
        // Merge any auto-detected deps into the existing package.json
        try {
          const existing = JSON.parse(mountFiles["/package.json"]);
          const merged = {
            ...existing,
            dependencies: { ...existing.dependencies, ...allDeps },
          };
          wcFiles["package.json"] = { file: { contents: JSON.stringify(merged, null, 2) } };
        } catch {
          // If parsing fails, use the file as-is
        }
      }
      await wc.mount(wcFiles);

      sendStatus("installing", "Installing dependencies...");
      term.writeln("\x1b[36m▸ npm install\x1b[0m");
      const installProcess = await wc.spawn("npm", ["install"]);
      installProcess.output.pipeTo(
        new WritableStream({
          write(chunk) {
            term.write(chunk);
          },
        }),
      );
      const installCode = await installProcess.exit;
      if (installCode !== 0) {
        sendStatus("error", `npm install failed (exit code ${installCode})`);
        return;
      }

      const cmd = getStartCommand(template, mountFiles);
      sendStatus("starting", `Starting ${cmd.join(" ")}...`);
      term.writeln(`\x1b[36m▸ ${cmd.join(" ")}\x1b[0m`);
      await spawnProcess(cmd);

      // Start interactive shell so users can type commands
      term.writeln("\x1b[36m▸ Shell ready — type commands below\x1b[0m");
      await startShell();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sendStatus("error", msg);
      term?.writeln(`\x1b[31m✗ ${msg}\x1b[0m`);
    }
  }

  const phaseColors: Record<Phase, string> = {
    waiting: "text-muted-foreground",
    booting: "text-yellow-500",
    installing: "text-yellow-500",
    starting: "text-yellow-500",
    ready: "text-green-500",
    error: "text-red-500",
  };

  const isNodeServer = currentTemplate === "node-server";
  const [terminalOpen, setTerminalOpen] = useState(true);

  // For UI templates: auto-collapse terminal once ready. For node-server: keep terminal open.
  useEffect(() => {
    if (phase === "ready" && !isNodeServer) setTerminalOpen(false);
  }, [phase, isNodeServer]);

  // Unified layout: preview area + toggle bar + terminal
  // Terminal div is always mounted (never unmounted) to preserve xterm content
  return (
    <div className="flex h-screen w-full flex-col bg-[#1e1e1e]">
      {/* Preview / status area */}
      <div className={isNodeServer && !previewUrl ? "hidden" : "flex-1 overflow-hidden"}>
        {previewUrl ? (
          <iframe
            ref={previewRef}
            src={previewUrl}
            className="h-full w-full border-0"
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
            title="Preview"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-[#888]">
            {phase !== "error" && phase !== "waiting" && (
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-yellow-500 border-t-transparent" />
            )}
            <span className={phaseColors[phase]}>{statusMessage}</span>
          </div>
        )}
      </div>

      {/* Terminal toggle bar */}
      <button
        onClick={() => setTerminalOpen(!terminalOpen)}
        className="flex items-center gap-2 border-t border-[#333] px-3 py-1 text-left hover:bg-[#2a2a2a] transition-colors"
      >
        <span className="text-[10px] text-[#888]">{terminalOpen ? "▼" : "▲"}</span>
        <span className="text-xs font-medium text-[#aaa]">Terminal</span>
        {phase !== "ready" && phase !== "waiting" && (
          <div className="h-2 w-2 animate-spin rounded-full border border-yellow-500 border-t-transparent" />
        )}
        {phase === "ready" && (
          <span className="text-[10px] text-green-500">ready</span>
        )}
        {phase === "error" && (
          <span className="text-[10px] text-red-500">error</span>
        )}
      </button>

      {/* Terminal — always mounted, toggle height to show/hide */}
      <div
        ref={terminalRef}
        className={`shrink-0 overflow-hidden border-t border-[#333] transition-[height] duration-200 ${
          terminalOpen
            ? isNodeServer ? "flex-1" : "h-[200px]"
            : "h-0 border-t-0"
        }`}
      />
    </div>
  );
}
