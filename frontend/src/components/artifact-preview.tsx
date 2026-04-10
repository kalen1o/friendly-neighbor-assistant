"use client";

import { useMemo } from "react";

interface ArtifactPreviewProps {
  code: string;
  type: "react" | "html";
  onLoad?: () => void;
}

/**
 * Strip import/export statements from user code.
 * React, useState, etc. are available as globals from the CDN.
 */
function prepareReactCode(code: string): string {
  return (
    code
      // Remove import statements (React is global via CDN)
      .replace(/^import\s+.*?from\s+['"].*?['"];?\s*$/gm, "")
      // Remove `export default ` prefix (keep the function/class/const)
      .replace(/^export\s+default\s+/gm, "")
      // Remove named exports
      .replace(/^export\s+/gm, "")
      .trim()
  );
}

const REACT_TEMPLATE = (rawCode: string) => {
  const code = prepareReactCode(rawCode);
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <script src="https://unpkg.com/react@18/umd/react.development.js" crossorigin></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js" crossorigin></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; }
    #error { color: #dc2626; padding: 16px; font-family: monospace; font-size: 13px; white-space: pre-wrap; display: none; background: #fef2f2; }
  </style>
</head>
<body>
  <div id="root"></div>
  <div id="error"></div>
  <script>
    // Make React hooks available globally (so user code can use useState etc. without import)
    var useState = React.useState;
    var useEffect = React.useEffect;
    var useRef = React.useRef;
    var useCallback = React.useCallback;
    var useMemo = React.useMemo;
    var useContext = React.useContext;
    var useReducer = React.useReducer;
    var createContext = React.createContext;
    var Fragment = React.Fragment;
  </script>
  <script type="text/babel">
    try {
      ${code}

      const _App = typeof App !== 'undefined' ? App : (() => React.createElement('div', {style:{padding:16}}, 'No App component found'));
      ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(_App));
    } catch (e) {
      document.getElementById('error').style.display = 'block';
      document.getElementById('error').textContent = e.message;
    }
  </script>
  <script>
    window.onerror = function(msg, src, line, col, err) {
      var el = document.getElementById('error');
      el.style.display = 'block';
      el.textContent = msg;
    };
  </script>
</body>
</html>`;
};

export function ArtifactPreview({ code, type, onLoad }: ArtifactPreviewProps) {
  const srcdoc = useMemo(() => {
    if (type === "html") return code;
    return REACT_TEMPLATE(code);
  }, [code, type]);

  return (
    <iframe
      srcDoc={srcdoc}
      sandbox="allow-scripts"
      className="h-full w-full border-0 bg-white"
      title="Artifact preview"
      onLoad={onLoad}
    />
  );
}
