export function getEnvVar(name: string): string | undefined {
  const fromProcess =
    typeof process !== "undefined" ? process.env?.[name] : undefined;
  if (fromProcess) return fromProcess;

  const metaEnv = (import.meta as any)?.env as Record<string, unknown> | undefined;
  const fromMeta = metaEnv?.[name];
  if (typeof fromMeta === "string" && fromMeta.length > 0) {
    return fromMeta;
  }

  return undefined;
}

export function getRequiredEnv(name: string): string {
  const value = getEnvVar(name);
  if (value) return value;

  throw new Error(`${name} not found in environment variables`);
}
