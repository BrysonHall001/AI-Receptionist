type Level = "info" | "warn" | "error" | "debug";

function emit(level: Level, message: string, meta?: unknown): void {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${level.toUpperCase()} ${message}`;
  const sink = level === "debug" ? console.log : console[level];
  if (meta !== undefined) sink(line, meta);
  else sink(line);
}

export const logger = {
  info: (m: string, meta?: unknown) => emit("info", m, meta),
  warn: (m: string, meta?: unknown) => emit("warn", m, meta),
  error: (m: string, meta?: unknown) => emit("error", m, meta),
  debug: (m: string, meta?: unknown) => emit("debug", m, meta),
};
