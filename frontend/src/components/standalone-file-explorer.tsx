"use client";

import { FileCode, Folder } from "lucide-react";

interface StandaloneFileExplorerProps {
  files: Record<string, string>;
  activeFile: string;
  onSelectFile: (path: string) => void;
}

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
}

function buildTree(files: Record<string, string>): TreeNode[] {
  const root: TreeNode[] = [];

  for (const path of Object.keys(files).sort()) {
    const parts = path.replace(/^\//, "").split("/");
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const fullPath = "/" + parts.slice(0, i + 1).join("/");
      const isDir = i < parts.length - 1;
      let node = current.find((n) => n.name === name);

      if (!node) {
        node = { name, path: fullPath, isDir, children: [] };
        current.push(node);
      }
      current = node.children;
    }
  }

  return root;
}

function TreeItem({
  node,
  activeFile,
  onSelect,
  depth,
}: {
  node: TreeNode;
  activeFile: string;
  onSelect: (path: string) => void;
  depth: number;
}) {
  return (
    <>
      <button
        onClick={() => !node.isDir && onSelect(node.path)}
        className={`flex w-full items-center gap-1.5 px-2 py-1 text-left text-xs hover:bg-muted/50 ${
          node.path === activeFile ? "bg-muted text-foreground" : "text-muted-foreground"
        }`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {node.isDir ? (
          <Folder className="h-3.5 w-3.5 shrink-0 text-blue-400" />
        ) : (
          <FileCode className="h-3.5 w-3.5 shrink-0" />
        )}
        <span className="truncate">{node.name}</span>
      </button>
      {node.children.map((child) => (
        <TreeItem
          key={child.path}
          node={child}
          activeFile={activeFile}
          onSelect={onSelect}
          depth={depth + 1}
        />
      ))}
    </>
  );
}

export function StandaloneFileExplorer({ files, activeFile, onSelectFile }: StandaloneFileExplorerProps) {
  const tree = buildTree(files);

  return (
    <div className="overflow-y-auto py-1">
      {tree.map((node) => (
        <TreeItem key={node.path} node={node} activeFile={activeFile} onSelect={onSelectFile} depth={0} />
      ))}
    </div>
  );
}
