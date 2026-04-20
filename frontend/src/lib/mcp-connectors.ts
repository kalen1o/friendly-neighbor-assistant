export interface McpConnectorTemplate {
  id: string;
  name: string;
  description: string;
  defaultUrl: string;
  authType: "none" | "bearer" | "custom";
  authLabel: string;
  iconSrc: string;
}

export const MCP_CONNECTOR_TEMPLATES: McpConnectorTemplate[] = [
  {
    id: "github",
    name: "GitHub",
    description: "Access repositories, issues, and pull requests.",
    defaultUrl: "https://api.githubcopilot.com/mcp/",
    authType: "bearer",
    authLabel: "GitHub Personal Access Token",
    iconSrc: "/connectors/github.svg",
  },
  {
    id: "gmail",
    name: "Gmail",
    description: "Read and send email from your Gmail inbox.",
    defaultUrl: "",
    authType: "bearer",
    authLabel: "OAuth Access Token",
    iconSrc: "/connectors/gmail.svg",
  },
  {
    id: "google-calendar",
    name: "Google Calendar",
    description: "View and manage calendar events.",
    defaultUrl: "",
    authType: "bearer",
    authLabel: "OAuth Access Token",
    iconSrc: "/connectors/google-calendar.svg",
  },
  {
    id: "google-drive",
    name: "Google Drive",
    description: "Browse and search files in your Drive.",
    defaultUrl: "",
    authType: "bearer",
    authLabel: "OAuth Access Token",
    iconSrc: "/connectors/google-drive.svg",
  },
];

export function findConnectedTemplate(
  template: McpConnectorTemplate,
  servers: { name: string; url: string }[]
): { name: string; url: string } | undefined {
  return servers.find(
    (s) =>
      s.name.trim().toLowerCase() === template.name.toLowerCase() ||
      (template.defaultUrl && s.url === template.defaultUrl)
  );
}
