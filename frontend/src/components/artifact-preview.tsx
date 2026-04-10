"use client";

import { useMemo } from "react";

interface ArtifactPreviewProps {
  code: string;
  type: "react" | "html";
}

const REACT_TEMPLATE = (code: string) => `<!DOCTYPE html>
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
    #error { color: #dc2626; padding: 16px; font-family: monospace; white-space: pre-wrap; display: none; }
  </style>
</head>
<body>
  <div id="root"></div>
  <div id="error"></div>
  <script type="text/babel" data-type="module">
    try {
      ${code}

      const _App = typeof App !== 'undefined' ? App : (() => React.createElement('div', null, 'No App component found'));
      ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(_App));
    } catch (e) {
      document.getElementById('error').style.display = 'block';
      document.getElementById('error').textContent = e.message + '\\n' + e.stack;
    }
  </script>
  <script>
    window.onerror = function(msg, src, line, col, err) {
      var el = document.getElementById('error');
      el.style.display = 'block';
      el.textContent = msg + '\\nLine: ' + line;
    };
  </script>
</body>
</html>`;

export function ArtifactPreview({ code, type }: ArtifactPreviewProps) {
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
    />
  );
}
