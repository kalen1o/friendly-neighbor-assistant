"use client";

import { useState } from "react";
import Image from "next/image";
import { AlertCircle, Check, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  MCP_CONNECTOR_TEMPLATES,
  findConnectedTemplate,
  type McpConnectorTemplate,
} from "@/lib/mcp-connectors";
import { createMcpServer, type McpServerOut } from "@/lib/api";

export function FeaturedConnectors({
  servers,
  onConnected,
}: {
  servers: McpServerOut[];
  onConnected: () => void;
}) {
  const [active, setActive] = useState<McpConnectorTemplate | null>(null);

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        {MCP_CONNECTOR_TEMPLATES.map((tpl) => {
          const connected = findConnectedTemplate(tpl, servers);
          return (
            <Card key={tpl.id}>
              <CardContent className="flex items-start gap-3 p-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border bg-white">
                  <Image src={tpl.iconSrc} alt={tpl.name} width={20} height={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{tpl.name}</p>
                    {connected && (
                      <Badge variant="secondary" className="gap-1 text-[10px]">
                        <Check className="h-3 w-3" /> Connected
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{tpl.description}</p>
                </div>
                <Button
                  size="sm"
                  variant={connected ? "outline" : "default"}
                  disabled={!!connected}
                  onClick={() => setActive(tpl)}
                  className="gap-1.5"
                >
                  {connected ? "Connected" : (<><Plus className="h-3.5 w-3.5" />Connect</>)}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {active && (
        <ConnectTemplateDialog
          template={active}
          onClose={() => setActive(null)}
          onConnected={() => {
            setActive(null);
            onConnected();
          }}
        />
      )}
    </>
  );
}

function ConnectTemplateDialog({
  template,
  onClose,
  onConnected,
}: {
  template: McpConnectorTemplate;
  onClose: () => void;
  onConnected: () => void;
}) {
  const [url, setUrl] = useState(template.defaultUrl);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!url.trim()) {
      setError("URL is required");
      return;
    }
    setSubmitting(true);
    try {
      await createMcpServer({
        name: template.name,
        url: url.trim(),
        description: template.description,
        auth_type: template.authType,
        auth_token: template.authType !== "none" ? token : undefined,
      });
      onConnected();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Image src={template.iconSrc} alt={template.name} width={16} height={16} />
            Connect {template.name}
          </DialogTitle>
          <DialogDescription>{template.description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-2">
            <Label>Server URL</Label>
            <Input
              placeholder="https://mcp.example.com/sse"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          {template.authType !== "none" && (
            <div className="space-y-2">
              <Label>{template.authLabel}</Label>
              <Input
                type="password"
                placeholder="your-token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Connecting..." : "Connect"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
