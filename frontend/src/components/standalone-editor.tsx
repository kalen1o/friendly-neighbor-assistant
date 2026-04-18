"use client";

import { useEffect, useRef } from "react";
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { oneDark } from "@codemirror/theme-one-dark";
import { defaultKeymap } from "@codemirror/commands";

interface StandaloneEditorProps {
  code: string;
  filePath: string;
  onChange: (code: string) => void;
  theme?: "light" | "dark";
}

function langFromPath(path: string) {
  if (path.endsWith(".css")) return css();
  if (path.endsWith(".html")) return html();
  return javascript({ jsx: true, typescript: path.endsWith(".ts") || path.endsWith(".tsx") });
}

export function StandaloneEditor({ code, filePath, onChange, theme = "dark" }: StandaloneEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  useEffect(() => {
    if (!containerRef.current) return;

    if (viewRef.current) {
      viewRef.current.destroy();
    }

    const extensions = [
      lineNumbers(),
      highlightActiveLine(),
      keymap.of(defaultKeymap),
      langFromPath(filePath),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onChangeRef.current(update.state.doc.toString());
        }
      }),
    ];
    if (theme === "dark") {
      extensions.push(oneDark);
    }

    const state = EditorState.create({ doc: code, extensions });
    viewRef.current = new EditorView({ state, parent: containerRef.current });

    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, theme]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== code) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: code },
      });
    }
  }, [code]);

  return <div ref={containerRef} className="h-full overflow-auto" />;
}
