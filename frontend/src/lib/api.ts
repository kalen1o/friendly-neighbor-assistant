const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ── Authenticated fetch with auto-refresh ──

let isRefreshing = false;
let refreshPromise: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/auth/refresh`, {
      method: "POST",
      credentials: "include",
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function authFetch(input: string, init?: RequestInit): Promise<Response> {
  const opts: RequestInit = {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  };

  let res = await fetch(input, opts);

  // If 401, try refreshing the access token once
  if (res.status === 401) {
    if (!isRefreshing) {
      isRefreshing = true;
      refreshPromise = tryRefresh();
    }
    const refreshed = await refreshPromise;
    isRefreshing = false;
    refreshPromise = null;

    if (refreshed) {
      res = await fetch(input, opts);
    }
  }

  return res;
}

// ── Auth API ──

export interface AuthResponse {
  access_token: string;
  token_type: string;
}

export interface UserInfo {
  id: string;
  email: string;
  name: string;
  created_at: string;
}

export async function register(email: string, password: string, name: string): Promise<AuthResponse> {
  const res = await fetch(`${API_BASE}/api/auth/register`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, name }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Registration failed" }));
    throw new Error(err.detail || "Registration failed");
  }
  return res.json();
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Login failed" }));
    throw new Error(err.detail || "Login failed");
  }
  return res.json();
}

export async function getMe(): Promise<UserInfo> {
  const res = await fetch(`${API_BASE}/api/auth/me`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Not authenticated");
  return res.json();
}

export async function logout(): Promise<void> {
  await fetch(`${API_BASE}/api/auth/logout`, {
    method: "POST",
    credentials: "include",
  });
}

// ── Types ──

export interface ChatSummary {
  id: string;
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
  id: string;
  chat_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  sources?: Source[] | null;
  metrics?: MessageMetrics | null;
}

export interface ChatDetail {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  messages: MessageOut[];
}

// ── Chat CRUD ──

export async function createChat(title?: string): Promise<ChatDetail> {
  const res = await authFetch(`${API_BASE}/api/chats`, {
    method: "POST",
    body: JSON.stringify({ title: title ?? null }),
  });
  if (!res.ok) throw new Error("Failed to create chat");
  return res.json();
}

export interface ChatListResponse {
  chats: ChatSummary[];
  next_cursor: string | null;
  has_more: boolean;
}

export async function listChats(cursor?: string | null, limit = 20): Promise<ChatListResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  const res = await authFetch(`${API_BASE}/api/chats?${params}`);
  if (!res.ok) throw new Error("Failed to list chats");
  return res.json();
}

export async function getChat(chatId: string): Promise<ChatDetail> {
  const res = await authFetch(`${API_BASE}/api/chats/${chatId}`);
  if (!res.ok) throw new Error("Failed to get chat");
  return res.json();
}

export async function updateChat(
  chatId: string,
  title: string
): Promise<ChatDetail> {
  const res = await authFetch(`${API_BASE}/api/chats/${chatId}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error("Failed to update chat");
  return res.json();
}

export async function deleteChat(chatId: string): Promise<void> {
  const res = await authFetch(`${API_BASE}/api/chats/${chatId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete chat");
}

export async function deleteAllChats(): Promise<void> {
  const res = await authFetch(`${API_BASE}/api/chats`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete all chats");
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

export type ChatMode = "fast" | "balanced" | "thinking";

export function sendMessage(
  chatId: string,
  content: string,
  callbacks: SSECallbacks,
  mode: ChatMode = "balanced"
): () => void {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch(`${API_BASE}/api/chats/${chatId}/messages`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, mode }),
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
        // Normalize CRLF -> LF (sse_starlette sends \r\n line endings)
        text = text.replace(/\r\n/g, "\n");
        const parts = text.split("\n\n");
        const remainder = parts.pop() || "";

        for (const part of parts) {
          if (!part.trim()) continue;
          let eventType = "message";
          const dataLines: string[] = [];

          for (const line of part.split("\n")) {
            if (line.startsWith("event:")) {
              eventType = line.slice(6).trim();
            } else if (line.startsWith("data:")) {
              // SSE spec: strip at most one leading space after "data:"
              const raw = line.slice(5);
              dataLines.push(raw.startsWith(" ") ? raw.slice(1) : raw);
            }
          }

          // SSE spec: multiple data lines are joined with newlines
          const data = dataLines.join("\n");

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
  id: string;
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
    credentials: "include",
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Upload failed" }));
    throw new Error(err.detail || "Upload failed");
  }
  return res.json();
}

export async function listDocuments(): Promise<DocumentOut[]> {
  const res = await authFetch(`${API_BASE}/api/documents`);
  if (!res.ok) throw new Error("Failed to list documents");
  return res.json();
}

export async function getDocumentStatus(docId: string): Promise<DocumentStatus> {
  const res = await authFetch(`${API_BASE}/api/documents/${docId}/status`);
  if (!res.ok) throw new Error("Failed to get document status");
  return res.json();
}

export async function deleteDocument(docId: string): Promise<void> {
  const res = await authFetch(`${API_BASE}/api/documents/${docId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete document");
}

// ── Skill Types ──

export interface SkillOut {
  id: string;
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
  const res = await authFetch(`${API_BASE}/api/skills`);
  if (!res.ok) throw new Error("Failed to list skills");
  return res.json();
}

export async function createSkill(skill: SkillCreate): Promise<SkillOut> {
  const res = await authFetch(`${API_BASE}/api/skills`, {
    method: "POST",
    body: JSON.stringify(skill),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Failed to create skill" }));
    throw new Error(err.detail || "Failed to create skill");
  }
  return res.json();
}

export async function updateSkill(
  skillId: string,
  updates: Partial<{ name: string; description: string; content: string; enabled: boolean }>
): Promise<SkillOut> {
  const res = await authFetch(`${API_BASE}/api/skills/${skillId}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error("Failed to update skill");
  return res.json();
}


export async function deleteSkill(skillId: string): Promise<void> {
  const res = await authFetch(`${API_BASE}/api/skills/${skillId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete skill");
}

// ── Hook Types ──

export interface HookOut {
  id: string;
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
  const res = await authFetch(`${API_BASE}/api/hooks`);
  if (!res.ok) throw new Error("Failed to list hooks");
  return res.json();
}

export async function createHook(hook: HookCreate): Promise<HookOut> {
  const res = await authFetch(`${API_BASE}/api/hooks`, {
    method: "POST",
    body: JSON.stringify(hook),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Failed to create hook" }));
    throw new Error(err.detail || "Failed to create hook");
  }
  return res.json();
}

export async function updateHook(
  hookId: string,
  updates: Partial<{ name: string; description: string; content: string; enabled: boolean; priority: number }>
): Promise<HookOut> {
  const res = await authFetch(`${API_BASE}/api/hooks/${hookId}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error("Failed to update hook");
  return res.json();
}

export async function deleteHook(hookId: string): Promise<void> {
  const res = await authFetch(`${API_BASE}/api/hooks/${hookId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete hook");
}

// ── MCP Types ──

export interface McpServerOut {
  id: string;
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
  id: string;
  server_id: string;
  tool_name: string;
  description: string | null;
  input_schema: string | null;
  enabled: boolean;
  created_at: string;
}

// ── MCP CRUD ──

export async function listMcpServers(): Promise<McpServerOut[]> {
  const res = await authFetch(`${API_BASE}/api/mcp/servers`);
  if (!res.ok) throw new Error("Failed to list MCP servers");
  return res.json();
}

export async function createMcpServer(server: {
  name: string;
  url: string;
  description?: string;
  auth_type?: string;
  auth_token?: string;
  auth_header?: string;
}): Promise<McpServerOut> {
  const res = await authFetch(`${API_BASE}/api/mcp/servers`, {
    method: "POST",
    body: JSON.stringify(server),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Failed to add server" }));
    throw new Error(err.detail || "Failed to add server");
  }
  return res.json();
}

export async function updateMcpServer(
  serverId: string,
  updates: {
    name?: string;
    url?: string;
    description?: string;
    auth_type?: string;
    auth_token?: string;
    auth_header?: string;
    enabled?: boolean;
  }
): Promise<McpServerOut> {
  const res = await authFetch(`${API_BASE}/api/mcp/servers/${serverId}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error("Failed to update server");
  return res.json();
}

export async function deleteMcpServer(serverId: string): Promise<void> {
  const res = await authFetch(`${API_BASE}/api/mcp/servers/${serverId}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete server");
}

export async function refreshMcpTools(serverId: string): Promise<McpToolOut[]> {
  const res = await authFetch(`${API_BASE}/api/mcp/servers/${serverId}/refresh`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to refresh tools");
  return res.json();
}

export async function listMcpTools(serverId: string): Promise<McpToolOut[]> {
  const res = await authFetch(`${API_BASE}/api/mcp/servers/${serverId}/tools`);
  if (!res.ok) throw new Error("Failed to list tools");
  return res.json();
}

export async function updateMcpTool(
  toolId: string,
  updates: { enabled?: boolean }
): Promise<McpToolOut> {
  const res = await authFetch(`${API_BASE}/api/mcp/tools/${toolId}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error("Failed to update tool");
  return res.json();
}

// ── Sharing Types ──

export interface ShareOut {
  id: string;
  chat_id: string;
  visibility: "public" | "authenticated";
  active: boolean;
  title: string | null;
  created_at: string;
}

export interface SharedMessage {
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface SharedChatView {
  id: string;
  title: string | null;
  visibility: "public" | "authenticated";
  created_at: string;
  messages: SharedMessage[];
}

// ── Sharing API ──

export async function createShare(
  chatId: string,
  visibility: "public" | "authenticated" = "public"
): Promise<ShareOut> {
  const res = await authFetch(`${API_BASE}/api/chats/${chatId}/share`, {
    method: "POST",
    body: JSON.stringify({ visibility }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: "Failed to share" } }));
    throw new Error(err.error?.message || err.detail || "Failed to share");
  }
  return res.json();
}

export async function listShares(chatId: string): Promise<ShareOut[]> {
  const res = await authFetch(`${API_BASE}/api/chats/${chatId}/shares`);
  if (!res.ok) throw new Error("Failed to list shares");
  return res.json();
}

export async function viewSharedChat(shareId: string): Promise<SharedChatView> {
  const res = await fetch(`${API_BASE}/api/shared/${shareId}`, {
    credentials: "include",
  });
  if (res.status === 401) throw new Error("LOGIN_REQUIRED");
  if (!res.ok) throw new Error("NOT_FOUND");
  return res.json();
}

export async function revokeShare(shareId: string): Promise<void> {
  const res = await authFetch(`${API_BASE}/api/shared/${shareId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to revoke share");
}
