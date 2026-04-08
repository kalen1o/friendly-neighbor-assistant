const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ── Types ──

export interface ChatSummary {
  id: number;
  title: string | null;
  updated_at: string;
}

export interface Source {
  type: "document" | "web" | "skill";
  text?: string;
  filename?: string;
  score?: number;
  title?: string;
  url?: string;
  snippet?: string;
  tool?: string;
}

export interface MessageMetrics {
  latency?: number;
  tokens_input?: number;
  tokens_output?: number;
  tokens_total?: number;
}

export interface MessageOut {
  id: number;
  chat_id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  sources?: Source[] | null;
  metrics?: MessageMetrics | null;
}

export interface ChatDetail {
  id: number;
  title: string | null;
  created_at: string;
  updated_at: string;
  messages: MessageOut[];
}

// ── Chat CRUD ──

export async function createChat(title?: string): Promise<ChatDetail> {
  const res = await fetch(`${API_BASE}/api/chats`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: title ?? null }),
  });
  if (!res.ok) throw new Error("Failed to create chat");
  return res.json();
}

export async function listChats(): Promise<ChatSummary[]> {
  const res = await fetch(`${API_BASE}/api/chats`);
  if (!res.ok) throw new Error("Failed to list chats");
  return res.json();
}

export async function getChat(chatId: number): Promise<ChatDetail> {
  const res = await fetch(`${API_BASE}/api/chats/${chatId}`);
  if (!res.ok) throw new Error("Failed to get chat");
  return res.json();
}

export async function updateChat(
  chatId: number,
  title: string
): Promise<ChatDetail> {
  const res = await fetch(`${API_BASE}/api/chats/${chatId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error("Failed to update chat");
  return res.json();
}

export async function deleteChat(chatId: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/chats/${chatId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete chat");
}

// ── Streaming messages ──

export interface SSECallbacks {
  onAction?: (action: string) => void;
  onMessage: (chunk: string) => void;
  onTitle: (title: string) => void;
  onSources?: (sources: Source[]) => void;
  onMetrics?: (metrics: MessageMetrics) => void;
  onDone: () => void;
  onError: (error: string) => void;
}

export function sendMessage(
  chatId: number,
  content: string,
  callbacks: SSECallbacks
): () => void {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch(`${API_BASE}/api/chats/${chatId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
        signal: controller.signal,
      });

      if (!res.ok) {
        callbacks.onError(`HTTP ${res.status}`);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        callbacks.onError("No response body");
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      const processEvents = (text: string) => {
        // Normalize CRLF → LF (sse_starlette sends \r\n line endings)
        text = text.replace(/\r\n/g, "\n");
        const parts = text.split("\n\n");
        const remainder = parts.pop() || "";

        for (const part of parts) {
          if (!part.trim()) continue;
          let eventType = "message";
          let data = "";

          for (const line of part.split("\n")) {
            if (line.startsWith("event:")) {
              eventType = line.slice(6).trim();
            } else if (line.startsWith("data:")) {
              // SSE spec: strip at most one leading space after "data:"
              const raw = line.slice(5);
              data = raw.startsWith(" ") ? raw.slice(1) : raw;
            }
          }

          switch (eventType) {
            case "action":
              callbacks.onAction?.(data);
              break;
            case "message":
              callbacks.onMessage(data);
              break;
            case "title":
              callbacks.onTitle(data);
              break;
            case "sources":
              try {
                callbacks.onSources?.(JSON.parse(data));
              } catch {}
              break;
            case "metrics":
              try {
                callbacks.onMetrics?.(JSON.parse(data));
              } catch {}
              break;
            case "done":
              callbacks.onDone();
              break;
            case "error":
              callbacks.onError(data);
              break;
          }
        }

        return remainder;
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          // Process any remaining buffered events
          if (buffer.trim()) {
            processEvents(buffer + "\n\n");
          }
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        buffer = processEvents(buffer);
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== "AbortError") {
        callbacks.onError(e.message);
      }
    }
  })();

  return () => controller.abort();
}

// ── Document Types ──

export interface DocumentOut {
  id: number;
  filename: string;
  file_type: string;
  file_size: number;
  status: "processing" | "ready" | "failed";
  error_message: string | null;
  chunk_count: number;
  created_at: string;
}

export interface DocumentStatus {
  status: "processing" | "ready" | "failed";
  chunk_count: number;
  error_message: string | null;
}

// ── Document CRUD ──

export async function uploadDocument(file: File): Promise<DocumentOut> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API_BASE}/api/documents/upload`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Upload failed" }));
    throw new Error(err.detail || "Upload failed");
  }
  return res.json();
}

export async function listDocuments(): Promise<DocumentOut[]> {
  const res = await fetch(`${API_BASE}/api/documents`);
  if (!res.ok) throw new Error("Failed to list documents");
  return res.json();
}

export async function getDocumentStatus(docId: number): Promise<DocumentStatus> {
  const res = await fetch(`${API_BASE}/api/documents/${docId}/status`);
  if (!res.ok) throw new Error("Failed to get document status");
  return res.json();
}

export async function deleteDocument(docId: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/documents/${docId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete document");
}

// ── Skill Types ──

export interface SkillOut {
  id: number;
  name: string;
  description: string;
  skill_type: string;
  content: string;
  enabled: boolean;
  builtin: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export interface SkillCreate {
  name: string;
  description: string;
  skill_type: string;
  content: string;
}

// ── Skill CRUD ──

export async function listSkills(): Promise<SkillOut[]> {
  const res = await fetch(`${API_BASE}/api/skills`);
  if (!res.ok) throw new Error("Failed to list skills");
  return res.json();
}

export async function createSkill(skill: SkillCreate): Promise<SkillOut> {
  const res = await fetch(`${API_BASE}/api/skills`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(skill),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Failed to create skill" }));
    throw new Error(err.detail || "Failed to create skill");
  }
  return res.json();
}

export async function updateSkill(
  skillId: number,
  updates: Partial<{ name: string; description: string; content: string; enabled: boolean }>
): Promise<SkillOut> {
  const res = await fetch(`${API_BASE}/api/skills/${skillId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error("Failed to update skill");
  return res.json();
}


export async function deleteSkill(skillId: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/skills/${skillId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete skill");
}

// ── Hook Types ──

export interface HookOut {
  id: number;
  name: string;
  description: string;
  hook_type: string;
  hook_point: string;
  priority: number;
  content: string;
  enabled: boolean;
  builtin: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export interface HookCreate {
  name: string;
  description: string;
  hook_type: string;
  hook_point: string;
  priority: number;
  content: string;
}

// ── Hook CRUD ──

export async function listHooks(): Promise<HookOut[]> {
  const res = await fetch(`${API_BASE}/api/hooks`);
  if (!res.ok) throw new Error("Failed to list hooks");
  return res.json();
}

export async function createHook(hook: HookCreate): Promise<HookOut> {
  const res = await fetch(`${API_BASE}/api/hooks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(hook),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Failed to create hook" }));
    throw new Error(err.detail || "Failed to create hook");
  }
  return res.json();
}

export async function updateHook(
  hookId: number,
  updates: Partial<{ name: string; description: string; content: string; enabled: boolean; priority: number }>
): Promise<HookOut> {
  const res = await fetch(`${API_BASE}/api/hooks/${hookId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error("Failed to update hook");
  return res.json();
}

export async function deleteHook(hookId: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/hooks/${hookId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete hook");
}

// ── MCP Types ──

export interface McpServerOut {
  id: number;
  name: string;
  url: string;
  description: string | null;
  auth_type: string;
  enabled: boolean;
  tool_count: number;
  enabled_tool_count: number;
  created_at: string;
}

export interface McpToolOut {
  id: number;
  server_id: number;
  tool_name: string;
  description: string | null;
  input_schema: string | null;
  enabled: boolean;
  created_at: string;
}

// ── MCP CRUD ──

export async function listMcpServers(): Promise<McpServerOut[]> {
  const res = await fetch(`${API_BASE}/api/mcp/servers`);
  if (!res.ok) throw new Error("Failed to list MCP servers");
  return res.json();
}

export async function createMcpServer(server: {
  name: string;
  url: string;
  description?: string;
  auth_type?: string;
  auth_token?: string;
}): Promise<McpServerOut> {
  const res = await fetch(`${API_BASE}/api/mcp/servers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(server),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Failed to add server" }));
    throw new Error(err.detail || "Failed to add server");
  }
  return res.json();
}

export async function deleteMcpServer(serverId: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/mcp/servers/${serverId}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete server");
}

export async function refreshMcpTools(serverId: number): Promise<McpToolOut[]> {
  const res = await fetch(`${API_BASE}/api/mcp/servers/${serverId}/refresh`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to refresh tools");
  return res.json();
}

export async function listMcpTools(serverId: number): Promise<McpToolOut[]> {
  const res = await fetch(`${API_BASE}/api/mcp/servers/${serverId}/tools`);
  if (!res.ok) throw new Error("Failed to list tools");
  return res.json();
}

export async function updateMcpTool(
  toolId: number,
  updates: { enabled?: boolean }
): Promise<McpToolOut> {
  const res = await fetch(`${API_BASE}/api/mcp/tools/${toolId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error("Failed to update tool");
  return res.json();
}
