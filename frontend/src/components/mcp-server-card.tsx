"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Trash2, RefreshCw, Server, Plug, ChevronDown, ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EditServerDialog } from "@/components/mcp-server-dialog";
import {
  listMcpTools, refreshMcpTools, updateMcpTool,
  type McpServerOut, type McpToolOut,
} from "@/lib/api";

export function ServerCard({
  server,
  onDelete,
  onRefresh,
}: {
  server: McpServerOut;
  onDelete: () => void;
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [tools, setTools] = useState<McpToolOut[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const loadTools = useCallback(async () => {
    try {
      setTools(await listMcpTools(server.id));
    } catch (e) {
      console.error(e);
    }
  }, [server.id]);

  useEffect(() => {
    if (expanded) loadTools();
  }, [expanded, loadTools]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshMcpTools(server.id);
      await loadTools();
      onRefresh();
    } catch (e) {
      console.error(e);
    } finally {
      setRefreshing(false);
    }
  };

  const handleToggleTool = async (tool: McpToolOut) => {
    try {
      await updateMcpTool(tool.id, { enabled: !tool.enabled });
      await loadTools();
      onRefresh();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <>
    <Card>
      <CardContent className="p-0">
        <div className="flex items-center justify-between px-4 py-3">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-3 min-w-0 text-left"
          >
            {expanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
            <Server className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="text-sm font-medium">{server.name}</p>
              <p className="truncate text-xs text-muted-foreground">{server.url}</p>
            </div>
          </button>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-[10px]">
              {server.enabled_tool_count}/{server.tool_count} tools
            </Badge>
            <EditServerDialog server={server} onUpdated={onRefresh} />
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleRefresh} disabled={refreshing}>
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setConfirmOpen(true)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        {expanded && (
          <div className="border-t divide-y">
            {tools.length === 0 ? (
              <div className="px-4 py-3 text-center text-xs text-muted-foreground">
                No tools discovered. Try refreshing.
              </div>
            ) : (
              tools.map((tool) => (
                <div key={tool.id} className="flex items-center justify-between px-4 py-2.5 pl-12">
                  <div className="flex items-center gap-2 min-w-0">
                    <Plug className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="text-xs font-medium">{tool.tool_name}</p>
                      {tool.description && (
                        <p className="truncate text-[10px] text-muted-foreground">{tool.description}</p>
                      )}
                    </div>
                  </div>
                  <Switch
                    checked={tool.enabled}
                    onCheckedChange={() => handleToggleTool(tool)}
                  />
                </div>
              ))
            )}
          </div>
        )}
      </CardContent>
    </Card>
    <ConfirmDialog
      open={confirmOpen}
      onOpenChange={setConfirmOpen}
      title="Delete MCP server?"
      description={`"${server.name}" and all its tools will be permanently deleted.`}
      onConfirm={onDelete}
    />
    </>
  );
}
