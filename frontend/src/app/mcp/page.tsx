"use client";

import { useCallback, useEffect, useState } from "react";
import { AddServerDialog } from "@/components/mcp-server-dialog";
import { ServerCard } from "@/components/mcp-server-card";
import { Card, CardContent } from "@/components/ui/card";
import {
  deleteMcpServer, listMcpServers,
  type McpServerOut,
} from "@/lib/api";

export default function McpPage() {
  const [servers, setServers] = useState<McpServerOut[]>([]);

  const fetchServers = useCallback(async () => {
    try { setServers(await listMcpServers()); } catch (e) { console.error(e); }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void fetchServers(); }, [fetchServers]);

  const handleDelete = async (serverId: string) => {
    try { await deleteMcpServer(serverId); await fetchServers(); } catch (e) { console.error(e); }
  };

  return (
    <div className="flex flex-1 flex-col overflow-y-auto p-4 md:p-6">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">MCP Servers</h1>
          <AddServerDialog onCreated={fetchServers} />
        </div>

        {servers.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No MCP servers connected. Click &ldquo;Add Server&rdquo; to connect one.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {servers.map((server) => (
              <ServerCard
                key={server.id}
                server={server}
                onDelete={() => handleDelete(server.id)}
                onRefresh={fetchServers}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
