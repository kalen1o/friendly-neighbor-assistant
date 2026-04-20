"use client";

import { useCallback, useEffect, useState } from "react";
import { AddServerDialog } from "@/components/mcp-server-dialog";
import { ServerCard } from "@/components/mcp-server-card";
import { FeaturedConnectors } from "@/components/mcp-featured-connectors";
import { Card, CardContent } from "@/components/ui/card";
import {
  deleteMcpServer, listMcpServers,
  type McpServerOut,
} from "@/lib/api";
import { MCP_CONNECTOR_TEMPLATES } from "@/lib/mcp-connectors";

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

  const templateNames = new Set(
    MCP_CONNECTOR_TEMPLATES.map((t) => t.name.toLowerCase())
  );
  const customServers = servers.filter(
    (s) => !templateNames.has(s.name.trim().toLowerCase())
  );

  return (
    <div className="flex flex-1 flex-col overflow-y-auto p-4 md:p-6">
      <div className="mx-auto w-full max-w-3xl space-y-8">
        <section className="space-y-3">
          <h1 className="text-2xl font-semibold">MCP Servers</h1>
          <p className="text-sm text-muted-foreground">
            One-click connectors for common services.
          </p>
          <FeaturedConnectors servers={servers} onConnected={fetchServers} />
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Custom servers</h2>
              <p className="text-xs text-muted-foreground">
                Connect any MCP-compatible server.
              </p>
            </div>
            <AddServerDialog onCreated={fetchServers} />
          </div>

          {customServers.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                No custom servers connected. Click &ldquo;Add Server&rdquo; to connect one.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {customServers.map((server) => (
                <ServerCard
                  key={server.id}
                  server={server}
                  onDelete={() => handleDelete(server.id)}
                  onRefresh={fetchServers}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
