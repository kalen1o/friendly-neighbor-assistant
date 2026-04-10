"use client";

import { useCallback } from "react";
import Editor from "react-simple-code-editor";
import Prism from "prismjs";
import "prismjs/components/prism-markup";
import "prismjs/components/prism-css";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-jsx";
import "./code-editor.css";

interface CodeEditorProps {
  value: string;
  onChange: (code: string) => void;
  language: "jsx" | "html";
}

export function CodeEditor({ value, onChange, language }: CodeEditorProps) {
  const highlight = useCallback(
    (code: string) => {
      const grammar =
        language === "jsx"
          ? Prism.languages.jsx
          : Prism.languages.markup;
      return Prism.highlight(code, grammar, language === "jsx" ? "jsx" : "markup");
    },
    [language]
  );

  return (
    <div className="code-editor-wrapper h-full overflow-auto">
      <Editor
        value={value}
        onValueChange={onChange}
        highlight={highlight}
        padding={16}
        className="code-editor"
        textareaClassName="code-editor-textarea"
        style={{
          fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
          fontSize: 13,
          lineHeight: 1.6,
          minHeight: "100%",
        }}
      />
    </div>
  );
}
