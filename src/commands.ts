export interface CommandSnippet {
  id: string;
  name: string;
  command: string;
  createdAt: number;
  dangerous: boolean;
}

const STORAGE_KEY = "eterminal.commands.v1";

export const SEED_COMMAND = "claude --dangerously-skip-permissions";

const DANGEROUS_RE =
  /(?:--dangerously[\w-]*|rm\s+-rf|del\s+\/[sf]|format\s+[a-z]:|shutdown\b|Remove-Item\b.*-Recurse)/iu;

export function isDangerousCommand(command: string): boolean {
  return DANGEROUS_RE.test(command);
}

function newId(): string {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : `cmd-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalize(item: unknown): CommandSnippet | null {
  if (!item || typeof item !== "object") return null;
  const source = item as Record<string, unknown>;
  const command = typeof source.command === "string" ? source.command.trim() : "";
  if (!command) return null;
  const name = typeof source.name === "string" && source.name.trim() ? source.name.trim() : command;
  const id =
    typeof source.id === "string" && source.id.length > 0 ? source.id : newId();
  const createdAt =
    typeof source.createdAt === "number" && Number.isFinite(source.createdAt)
      ? source.createdAt
      : Date.now();
  return {
    id,
    name: name.slice(0, 80),
    command: command.slice(0, 4000),
    createdAt,
    dangerous: isDangerousCommand(command),
  };
}

/** Seeds the user's requested Claude shortcut once; it is never auto-run. */
function seedCommands(): CommandSnippet[] {
  return [
    {
      id: newId(),
      name: "Claude Code · 跳过权限",
      command: SEED_COMMAND,
      createdAt: Date.now(),
      dangerous: true,
    },
  ];
}

export function loadCommandSnippets(): CommandSnippet[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed
          .map(normalize)
          .filter((item): item is CommandSnippet => item !== null)
          .slice(0, 80);
      }
    }
  } catch {
    /* corrupted storage -> fall through to seed */
  }

  const seeded = seedCommands();
  persistCommandSnippets(seeded);
  return seeded;
}

export function persistCommandSnippets(commands: CommandSnippet[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(commands));
  } catch {
    /* storage unavailable — commands stay in memory for this session */
  }
}

export function createCommandSnippet(name: string, command: string): CommandSnippet | null {
  const normalized = normalize({ name, command, id: newId(), createdAt: Date.now() });
  return normalized;
}

export function normalizeCommandSnippet(item: unknown): CommandSnippet | null {
  return normalize(item);
}

export function formatCommandName(command: string): string {
  const singleLine = command.replace(/\s+/gu, " ").trim();
  return singleLine.length > 52 ? `${singleLine.slice(0, 51)}…` : singleLine;
}
