"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, AlertCircle, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  createMcpServer, updateMcpServer,
  type McpServerOut,
} from "@/lib/api";

const serverSchema = z.object({
  name: z.string().min(1, "Name is required"),
  url: z.string().url("Must be a valid URL"),
  description: z.string().optional(),
  auth_type: z.enum(["none", "bearer", "custom"]),
  auth_token: z.string().optional(),
  auth_header: z.string().optional(),
});

type ServerFormData = z.infer<typeof serverSchema>;

export function AddServerDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, setValue, watch, reset, formState: { errors, isSubmitting } } = useForm<ServerFormData>({
    resolver: zodResolver(serverSchema),
    defaultValues: { name: "", url: "", description: "", auth_type: "none", auth_token: "", auth_header: "" },
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
        auth_token: data.auth_type !== "none" ? data.auth_token : undefined,
        auth_header: data.auth_type === "custom" ? data.auth_header : undefined,
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
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="bearer">Bearer Token (Authorization header)</SelectItem>
                <SelectItem value="custom">Custom Header (e.g. API key)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {authType === "custom" && (
            <div className="space-y-2">
              <Label>Header Name</Label>
              <Input placeholder="API_KEY" {...register("auth_header")} />
            </div>
          )}
          {authType !== "none" && (
            <div className="space-y-2">
              <Label>{authType === "bearer" ? "Bearer Token" : "API Key"}</Label>
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

export function EditServerDialog({ server, onUpdated }: { server: McpServerOut; onUpdated: () => void }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, setValue, watch, reset, formState: { errors, isSubmitting } } = useForm<ServerFormData>({
    resolver: zodResolver(serverSchema),
    defaultValues: {
      name: server.name,
      url: server.url,
      description: server.description || "",
      auth_type: (server.auth_type as ServerFormData["auth_type"]) || "none",
      auth_token: "",
      auth_header: "",
    },
  });
  const authType = watch("auth_type");

  const onSubmit = async (data: ServerFormData) => {
    setError(null);
    try {
      const updates: Record<string, string | undefined> = {
        name: data.name,
        url: data.url,
        description: data.description,
        auth_type: data.auth_type,
      };
      if (data.auth_type !== "none" && data.auth_token) {
        updates.auth_token = data.auth_token;
      }
      if (data.auth_type === "custom" && data.auth_header) {
        updates.auth_header = data.auth_header;
      }
      await updateMcpServer(server.id, updates);
      setOpen(false);
      onUpdated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update server");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setError(null); }}>
      <DialogTrigger render={<Button variant="ghost" size="icon" className="h-7 w-7" />}>
        <Pencil className="h-3.5 w-3.5" />
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit MCP Server</DialogTitle>
          <DialogDescription>Update connection settings for {server.name}.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {error && <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertDescription>{error}</AlertDescription></Alert>}
          <div className="space-y-2">
            <Label>Name</Label>
            <Input {...register("name")} />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>URL</Label>
            <Input {...register("url")} />
            {errors.url && <p className="text-xs text-destructive">{errors.url.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Description (optional)</Label>
            <Input {...register("description")} />
          </div>
          <div className="space-y-2">
            <Label>Authentication</Label>
            <Select value={authType} onValueChange={(v) => setValue("auth_type", v as ServerFormData["auth_type"])}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="bearer">Bearer Token (Authorization header)</SelectItem>
                <SelectItem value="custom">Custom Header (e.g. API key)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {authType === "custom" && (
            <div className="space-y-2">
              <Label>Header Name</Label>
              <Input placeholder="API_KEY" {...register("auth_header")} />
            </div>
          )}
          {authType !== "none" && (
            <div className="space-y-2">
              <Label>{authType === "bearer" ? "Bearer Token" : "API Key"}</Label>
              <Input type="password" placeholder="Leave empty to keep current" {...register("auth_token")} />
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
