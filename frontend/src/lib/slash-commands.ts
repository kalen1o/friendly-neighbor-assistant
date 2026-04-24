import { listSkills, type UserInfo } from "@/lib/api";

export const SLASH_COMMANDS = [
  { name: "help", description: "Show available slash commands" },
  { name: "skills", description: "List your enabled skills" },
  { name: "session", description: "Show current chat and account info" },
] as const;

export type SlashCommandName = (typeof SLASH_COMMANDS)[number]["name"];

export interface ParsedCommand {
  name: SlashCommandName;
  args: string;
}

export interface SlashContext {
  chatId: string;
  chatModelId: string | null;
  user: UserInfo | null;
}

export function parseSlashCommand(input: string): ParsedCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;
  const [head, ...rest] = trimmed.slice(1).split(/\s+/);
  const name = head.toLowerCase();
  const known = SLASH_COMMANDS.find((c) => c.name === name);
  if (!known) return null;
  return { name: known.name, args: rest.join(" ") };
}

export async function executeSlashCommand(
  cmd: ParsedCommand,
  ctx: SlashContext,
): Promise<string> {
  switch (cmd.name) {
    case "help":
      return renderHelp();
    case "skills":
      return await renderSkills();
    case "session":
      return renderSession(ctx);
  }
}

function renderHelp(): string {
  const rows = SLASH_COMMANDS.map((c) => `- \`/${c.name}\` — ${c.description}`).join("\n");
  return `### Available commands\n\n${rows}\n\nType a command at the start of your message. Anything else is sent to the assistant.`;
}

async function renderSkills(): Promise<string> {
  let skills;
  try {
    skills = await listSkills();
  } catch (err) {
    return `Couldn't load skills: ${(err as Error).message}`;
  }
  const enabled = skills.filter((s) => s.enabled);
  if (enabled.length === 0) return "No skills enabled. Manage them in **Settings → Skills**.";

  const byType = new Map<string, typeof enabled>();
  for (const s of enabled) {
    const list = byType.get(s.skill_type) ?? [];
    list.push(s);
    byType.set(s.skill_type, list);
  }

  const sections: string[] = [];
  for (const [type, list] of byType) {
    const heading = type.charAt(0).toUpperCase() + type.slice(1);
    const items = list
      .map((s) => {
        const badge = s.builtin ? " _(built-in)_" : "";
        return `- **${s.name}**${badge} — ${s.description}`;
      })
      .join("\n");
    sections.push(`**${heading}**\n${items}`);
  }

  return `### Enabled skills (${enabled.length})\n\n${sections.join("\n\n")}`;
}

function renderSession(ctx: SlashContext): string {
  const lines: string[] = ["### Session"];
  lines.push("");
  lines.push(`- **Chat ID:** \`${ctx.chatId}\``);
  lines.push(`- **Model:** ${ctx.chatModelId ?? "_default_"}`);

  if (ctx.user) {
    const u = ctx.user;
    lines.push("");
    lines.push("### Account");
    lines.push(`- **Name:** ${u.name}`);
    lines.push(`- **Email:** ${u.email}`);
    lines.push(`- **Role:** ${u.role}`);
    lines.push(`- **Memory:** ${u.memory_enabled ? "enabled" : "disabled"}`);
    lines.push(`- **Preferred model:** ${u.preferred_model ?? "_none_"}`);

    const persona: Array<[string, string | null]> = [
      ["Nickname", u.personalization_nickname],
      ["Your role", u.personalization_role],
      ["Tone", u.personalization_tone],
      ["Length", u.personalization_length],
      ["Language", u.personalization_language],
      ["About you", u.personalization_about],
      ["Style", u.personalization_style],
    ];
    const set = persona.filter(([, v]) => v && v.trim().length > 0);
    if (set.length > 0) {
      lines.push("");
      lines.push("### Personalization");
      for (const [label, value] of set) lines.push(`- **${label}:** ${value}`);
    }
  } else {
    lines.push("- **Account:** _not signed in_");
  }

  return lines.join("\n");
}
