"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Plus, Trash2, RefreshCw, Server, Plug, AlertCircle, ChevronDown, ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  createMcpServer, deleteMcpServer, listMcpServers, listMcpTools,
  refreshMcpTools, updateMcpTool,
  type McpServerOut, type McpToolOut,
} from "@/lib/api";

const serverSchema = z.object({
  name: z.string().min(1, "Name is required"),
  url: z.string().url("Must be a valid URL"),
  description: z.string().optional(),
  auth_type: z.enum(["none", "bearer"]),
  auth_token: z.string().optional(),
});

type ServerFormData = z.infer<typeof serverSchema>;

function AddServerDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, setValue, watch, reset, formState: { errors, isSubmitting } } = useForm<ServerFormData>({
    resolver: zodResolver(serverSchema),
    defaultValues: { name: "", url: "", description: "", auth_type: "none", auth_token: "" },
  });
  const authType = watch("auth_type");

  const onSubmit = async (data: ServerFormData) => {
    setError(null);
    try {
      await createMcpServer({
        name: data.name,
        url: data.url,
        description: data.description,
        auth_type: data.auth_type,
        auth_token: data.auth_type === "bearer" ? data.auth_token : undefined,
      });
      reset();
      setOpen(false);
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add server");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { reset(); setError(null); } }}>
      <DialogTrigger render={<Button size="sm" className="gap-1.5" />}>
        <Plus className="h-4 w-4" />Add Server
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add MCP Server</DialogTitle>
          <DialogDescription>Connect to an MCP server to discover and use its tools.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {error && <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertDescription>{error}</AlertDescription></Alert>}
          <div className="space-y-2">
            <Label>Name</Label>
            <Input placeholder="My MCP Server" {...register("name")} />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>URL</Label>
            <Input placeholder="https://mcp.example.com/sse" {...register("url")} />
            {errors.url && <p className="text-xs text-destructive">{errors.url.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Description (optional)</Label>
            <Input placeholder="What this server provides" {...register("description")} />
          </div>
          <div className="space-y-2">
            <Label>Authentication</Label>
            <Select defaultValue="none" onValueChange={(v) => setValue("auth_type", v as ServerFormData["auth_type"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="bearer">Bearer Token</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {authType === "bearer" && (
            <div className="space-y-2">
              <Label>Bearer Token</Label>
              <Input type="password" placeholder="your-api-token" {...register("auth_token")} />
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Connecting..." : "Add Server"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ServerCard({
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
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleRefresh} disabled={refreshing}>
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onDelete}>
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
  );
}

export default function McpPage() {
  const [servers, setServers] = useState<McpServerOut[]>([]);

  const fetchServers = useCallback(async () => {
    try { setServers(await listMcpServers()); } catch (e) { console.error(e); }
  }, []);

  useEffect(() => { fetchServers(); }, [fetchServers]);

  const handleDelete = async (serverId: number) => {
    try { await deleteMcpServer(serverId); await fetchServers(); } catch (e) { console.error(e); }
  };

  return (
    <div className="flex flex-1 flex-col overflow-y-auto p-6">
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
