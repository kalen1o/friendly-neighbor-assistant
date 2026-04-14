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
  role: string;
  memory_enabled: boolean;
  preferred_model: string | null;
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
  folder_id: string | null;
  model_id: string | null;
  has_notification: boolean;
  is_generating: boolean;
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
  params?: Record<string, unknown>;
  // Citation enhancements
  citation_index?: number;
  chunk_excerpt?: string;
  chunk_index?: number;
  relevance_score?: number;
}

export interface MessageMetrics {
  latency?: number;
  tokens_input?: number;
  tokens_output?: number;
  tokens_total?: number;
}

export interface MessageFileRef {
  id: string;
  name: string;
  type: string;
}

export interface MessageOut {
  id: string;
  chat_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  sources?: Source[] | null;
  metrics?: MessageMetrics | null;
  files?: MessageFileRef[] | null;
  status?: "generating" | "completed" | "error";
}

export interface ChatDetail {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  messages: MessageOut[];
  has_more?: boolean;
  next_cursor?: string | null;
  model_id?: string | null;
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

export async function listChats(
  cursor?: string | null,
  limit = 20,
  folderId?: string | null
): Promise<ChatListResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  if (folderId !== undefined && folderId !== null) params.set("folder_id", folderId);
  const res = await authFetch(`${API_BASE}/api/chats?${params}`);
  if (!res.ok) throw new Error("Failed to list chats");
  return res.json();
}

export async function getChat(chatId: string, limit?: number, before?: string): Promise<ChatDetail> {
  const params = new URLSearchParams();
  if (limit) params.set("limit", String(limit));
  if (before) params.set("before", before);
  const qs = params.toString();
  const res = await authFetch(`${API_BASE}/api/chats/${chatId}${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error("Failed to get chat");
  return res.json();
}

export async function updateChat(
  chatId: string,
  title?: string,
  folderId?: string | null,
  modelId?: string | null
): Promise<ChatDetail> {
  const body: Record<string, unknown> = {};
  if (title !== undefined) body.title = title;
  if (folderId !== undefined) body.folder_id = folderId === null ? "none" : folderId;
  if (modelId !== undefined) body.model_id = modelId === null ? "" : modelId;
  const res = await authFetch(`${API_BASE}/api/chats/${chatId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
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

// ── Folder Types ──

export interface FolderOut {
  id: string;
  name: string;
  parent_id: string | null;
  color: string | null;
  icon: string | null;
  position: number;
  chat_count: number;
}

export interface FolderCreate {
  name: string;
  parent_id?: string | null;
  color?: string | null;
  icon?: string | null;
}

export interface FolderUpdate {
  name?: string;
  parent_id?: string | null;
  color?: string | null;
  icon?: string | null;
  position?: number;
}

// ── Folder CRUD ──

export async function listFolders(): Promise<FolderOut[]> {
  const res = await authFetch(`${API_BASE}/api/folders`);
  if (!res.ok) throw new Error("Failed to list folders");
  return res.json();
}

export async function createFolder(folder: FolderCreate): Promise<FolderOut> {
  const res = await authFetch(`${API_BASE}/api/folders`, {
    method: "POST",
    body: JSON.stringify(folder),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Failed to create folder" }));
    throw new Error(err.detail || "Failed to create folder");
  }
  return res.json();
}

export async function updateFolder(
  folderId: string,
  updates: FolderUpdate
): Promise<FolderOut> {
  const res = await authFetch(`${API_BASE}/api/folders/${folderId}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Failed to update folder" }));
    throw new Error(err.detail || "Failed to update folder");
  }
  return res.json();
}

export async function deleteFolder(
  folderId: string,
  action: "move_up" | "delete_all"
): Promise<void> {
  const res = await authFetch(
    `${API_BASE}/api/folders/${folderId}?action=${action}`,
    { method: "DELETE" }
  );
  if (!res.ok) throw new Error("Failed to delete folder");
}

// ── Model Types ──

export interface ModelOut {
  id: string;
  name: string;
  provider: string;
  model_id: string;
  base_url: string | null;
  is_default: boolean;
  builtin: boolean;
  created_at: string | null;
}

export interface ModelCreate {
  name: string;
  provider: string;
  model_id: string;
  api_key: string;
  base_url?: string | null;
}

export interface ModelUpdate {
  name?: string;
  model_id?: string;
  api_key?: string;
  base_url?: string | null;
  is_default?: boolean;
}

export interface ModelTestResult {
  success: boolean;
  message: string;
}

// ── Model CRUD ──

export async function listModels(): Promise<ModelOut[]> {
  const res = await authFetch(`${API_BASE}/api/models`);
  if (!res.ok) throw new Error("Failed to list models");
  return res.json();
}

export async function createModel(model: ModelCreate): Promise<ModelOut> {
  const res = await authFetch(`${API_BASE}/api/models`, {
    method: "POST",
    body: JSON.stringify(model),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Failed to create model" }));
    throw new Error(err.detail || "Failed to create model");
  }
  return res.json();
}

export async function updateModel(
  modelId: string,
  updates: ModelUpdate
): Promise<ModelOut> {
  const res = await authFetch(`${API_BASE}/api/models/${modelId}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Failed to update model" }));
    throw new Error(err.detail || "Failed to update model");
  }
  return res.json();
}

export async function deleteModel(modelId: string): Promise<void> {
  const res = await authFetch(`${API_BASE}/api/models/${modelId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete model");
}

export async function testModel(modelId: string): Promise<ModelTestResult> {
  const res = await authFetch(`${API_BASE}/api/models/${modelId}/test`, {
    method: "POST",
  });
  if (!res.ok) throw new Error("Failed to test model");
  return res.json();
}

// ── Streaming messages ──

export interface WorkflowStep {
  name: string;
  status: string;
  parallel?: boolean;
}

export interface SSECallbacks {
  onAction?: (action: string) => void;
  onMessage: (chunk: string) => void;
  onTitle: (title: string) => void;
  onSources?: (sources: Source[]) => void;
  onMetrics?: (metrics: MessageMetrics) => void;
  onArtifact?: (artifact: ArtifactData) => void;
  onWorkflow?: (steps: WorkflowStep[]) => void;
  onWorkflowStep?: (step: WorkflowStep) => void;
  onDone: () => void;
  onError: (error: string) => void;
}

export type ChatMode = "fast" | "balanced" | "thinking";

export function sendMessage(
  chatId: string,
  content: string,
  callbacks: SSECallbacks,
  mode: ChatMode = "balanced",
  fileIds: string[] = []
): () => void {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch(`${API_BASE}/api/chats/${chatId}/messages`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, mode, file_ids: fileIds }),
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
            case "artifact":
              try {
                callbacks.onArtifact?.(JSON.parse(data));
              } catch {}
              break;
            case "workflow":
              try {
                const wf = JSON.parse(data);
                callbacks.onWorkflow?.(wf.steps);
              } catch {}
              break;
            case "workflow_step":
              try {
                callbacks.onWorkflowStep?.(JSON.parse(data));
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

// ── Artifact Types ──

export interface ArtifactData {
  id: string;
  type: "react" | "html";
  title: string;
  code: string;
}

export interface ArtifactOut extends ArtifactData {
  message_id: string;
  chat_id: string;
  artifact_type: string;
  created_at: string;
  updated_at: string;
}

// ── Artifact API ──

export async function listArtifacts(chatId: string): Promise<ArtifactOut[]> {
  const res = await authFetch(`${API_BASE}/api/chats/${chatId}/artifacts`);
  if (!res.ok) throw new Error("Failed to list artifacts");
  return res.json();
}

export async function updateArtifact(
  artifactId: string,
  updates: { code?: string; title?: string }
): Promise<ArtifactOut> {
  const res = await authFetch(`${API_BASE}/api/artifacts/${artifactId}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error("Failed to update artifact");
  return res.json();
}

// ── Search ──

export interface SearchResult {
  chat_id: string;
  chat_title: string | null;
  message_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface SearchResponse {
  results: SearchResult[];
  total: number;
}

export async function searchChats(query: string): Promise<SearchResponse> {
  const res = await authFetch(`${API_BASE}/api/chats/search?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error("Search failed");
  return res.json();
}

// ── Export ──

export async function exportChat(chatId: string, format: "markdown" | "pdf"): Promise<void> {
  const res = await fetch(`${API_BASE}/api/chats/${chatId}/export?format=${format}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Export failed");

  // Get filename from Content-Disposition header or generate one
  const disposition = res.headers.get("Content-Disposition") || "";
  const filenameMatch = disposition.match(/filename="?([^"]+)"?/);
  const filename = filenameMatch?.[1] || `conversation.${format === "pdf" ? "pdf" : "md"}`;

  // Download the file
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── File Uploads ──

export interface ChatFileOut {
  id: string;
  filename: string;
  file_type: string;
  file_size: number;
}

export async function uploadChatFile(file: File): Promise<ChatFileOut> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API_BASE}/api/uploads`, {
    method: "POST",
    credentials: "include",
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: "Upload failed" } }));
    throw new Error(err.error?.message || err.detail || "Upload failed");
  }
  return res.json();
}

export function getFileUrl(fileId: string): string {
  return `${API_BASE}/api/uploads/${fileId}`;
}

// ── Usage ──

export interface UsageStats {
  period: string;
  messages: number;
  tokens_input: number;
  tokens_output: number;
  tokens_total: number;
  tool_calls: number;
}

export async function getUsage(): Promise<UsageStats> {
  const res = await authFetch(`${API_BASE}/api/auth/usage`);
  if (!res.ok) throw new Error("Failed to get usage");
  return res.json();
}

// ── Analytics ──

export interface MessageCost {
  message_id: string;
  chat_id: string;
  chat_title: string | null;
  created_at: string;
  tokens_input: number;
  tokens_output: number;
  tokens_total: number;
  cost_input: number;
  cost_output: number;
  cost_total: number;
  latency: number | null;
}

export interface DailyAggregate {
  date: string;
  messages: number;
  tokens_total: number;
  cost_total: number;
}

export interface AnalyticsResponse {
  period: string;
  summary: {
    total_messages: number;
    tokens_input: number;
    tokens_output: number;
    tokens_total: number;
    cost_total: number;
    cost_input: number;
    cost_output: number;
  };
  daily: DailyAggregate[];
  messages: MessageCost[];
}

export async function getAnalytics(days: number = 30): Promise<AnalyticsResponse> {
  const res = await authFetch(`${API_BASE}/api/analytics?days=${days}`);
  if (!res.ok) throw new Error("Failed to get analytics");
  return res.json();
}

// ── Admin Types ──

export interface UserAdmin {
  id: string;
  email: string;
  name: string;
  role: string;
  is_active: boolean;
  is_env_admin: boolean;
  created_at: string;
  messages_this_month: number;
  tokens_this_month: number;
}

export interface SystemAnalytics {
  total_users: number;
  active_users_30d: number;
  total_messages: number;
  total_tokens: number;
  total_cost: number;
  daily: { date: string; messages: number; tokens: number; cost: number }[];
}

export interface AuditEntry {
  id: number;
  user_email: string | null;
  user_name: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  details: string | null;
  ip_address: string | null;
  created_at: string;
}

export interface AuditPage {
  entries: AuditEntry[];
  next_cursor: string | null;
  has_more: boolean;
}

export interface UserQuotaOut {
  user_id: string;
  user_email: string;
  user_name: string;
  messages_soft: number | null;
  messages_hard: number | null;
  tokens_soft: number | null;
  tokens_hard: number | null;
  messages_used: number;
  tokens_used: number;
}

// ── Admin API ──

export async function adminListUsers(): Promise<UserAdmin[]> {
  const res = await authFetch(`${API_BASE}/api/admin/users`);
  if (!res.ok) throw new Error("Failed to list users");
  return res.json();
}

export async function adminUpdateUser(
  userId: string,
  updates: { role?: string; is_active?: boolean }
): Promise<UserAdmin> {
  const res = await authFetch(`${API_BASE}/api/admin/users/${userId}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Failed" }));
    throw new Error(err.detail || "Failed to update user");
  }
  return res.json();
}

export async function adminDeleteUser(userId: string): Promise<void> {
  const res = await authFetch(`${API_BASE}/api/admin/users/${userId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Failed" }));
    throw new Error(err.detail || "Failed to delete user");
  }
}

export async function adminGetAnalytics(days = 30): Promise<SystemAnalytics> {
  const res = await authFetch(`${API_BASE}/api/admin/analytics?days=${days}`);
  if (!res.ok) throw new Error("Failed to get analytics");
  return res.json();
}

export async function adminGetAudit(
  cursor?: string | null,
  action?: string,
  userId?: string
): Promise<AuditPage> {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  if (action) params.set("action", action);
  if (userId) params.set("user_id", userId);
  const qs = params.toString();
  const res = await authFetch(`${API_BASE}/api/admin/audit${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error("Failed to get audit log");
  return res.json();
}

export async function adminListQuotas(): Promise<UserQuotaOut[]> {
  const res = await authFetch(`${API_BASE}/api/admin/quotas`);
  if (!res.ok) throw new Error("Failed to list quotas");
  return res.json();
}

export async function adminSetQuota(
  userId: string,
  quota: { messages_soft?: number | null; messages_hard?: number | null; tokens_soft?: number | null; tokens_hard?: number | null }
): Promise<UserQuotaOut> {
  const res = await authFetch(`${API_BASE}/api/admin/quotas/${userId}`, {
    method: "PUT",
    body: JSON.stringify(quota),
  });
  if (!res.ok) throw new Error("Failed to set quota");
  return res.json();
}

export async function adminDeleteQuota(userId: string): Promise<void> {
  const res = await authFetch(`${API_BASE}/api/admin/quotas/${userId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete quota");
}

// ── OAuth Providers ──

export interface AuthProviders {
  google: boolean;
  github: boolean;
}

export async function getAuthProviders(): Promise<AuthProviders> {
  try {
    const res = await fetch(`${API_BASE}/api/auth/providers`);
    if (!res.ok) return { google: false, github: false };
    return res.json();
  } catch {
    return { google: false, github: false };
  }
}

// ── Account Deletion ──

export async function updateMe(data: { memory_enabled?: boolean; preferred_model?: string | null }): Promise<UserInfo> {
  const res = await authFetch(`${API_BASE}/api/auth/me`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to update settings");
  return res.json();
}

export async function deleteAccount(): Promise<void> {
  const res = await authFetch(`${API_BASE}/api/auth/me`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete account");
}

// ── Webhook Integrations ──

export interface WebhookIntegration {
  id: string;
  name: string;
  platform: "slack" | "discord" | "generic";
  direction: "outbound" | "inbound" | "both";
  webhook_url: string | null;
  inbound_token: string | null;
  inbound_url: string | null;
  subscribed_events: string[];
  config: Record<string, unknown> | null;
  enabled: boolean;
  created_at: string;
}

export interface WebhookCreate {
  name: string;
  platform: "slack" | "discord" | "generic";
  direction: "outbound" | "inbound" | "both";
  webhook_url?: string;
  subscribed_events?: string[];
  config_json?: Record<string, unknown>;
}

export async function listWebhooks(): Promise<WebhookIntegration[]> {
  const res = await authFetch(`${API_BASE}/api/webhooks`);
  if (!res.ok) throw new Error("Failed to list webhooks");
  return res.json();
}

export async function createWebhook(data: WebhookCreate): Promise<WebhookIntegration> {
  const res = await authFetch(`${API_BASE}/api/webhooks`, {
    method: "POST",
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to create webhook");
  return res.json();
}

export async function updateWebhook(
  id: string,
  data: Partial<WebhookCreate & { enabled: boolean }>
): Promise<WebhookIntegration> {
  const res = await authFetch(`${API_BASE}/api/webhooks/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to update webhook");
  return res.json();
}

export async function deleteWebhook(id: string): Promise<void> {
  const res = await authFetch(`${API_BASE}/api/webhooks/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete webhook");
}
