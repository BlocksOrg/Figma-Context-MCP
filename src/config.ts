import { config as loadEnv } from "dotenv";
import { readFileSync } from "fs";
import { homedir } from "os";
import { resolve as resolvePath } from "path";
import type { CredentialSource, FigmaCredential } from "./services/figma.js";
import { VALID_OUTPUT_FORMATS, isOutputFormat, type OutputFormat } from "./utils/serialize.js";

export type Source = "cli" | "env" | "default";

export interface Resolved<T> {
  value: T;
  source: Source;
}

export interface ServerFlags {
  figmaApiKey?: string;
  figmaOauthToken?: string;
  figmaOauthTokenFile?: string;
  env?: string;
  port?: number;
  host?: string;
  json?: boolean;
  format?: string;
  skipImageDownloads?: boolean;
  imageDir?: string;
  proxy?: string;
  stdio?: boolean;
}

export interface ServerConfig {
  auth: CredentialSource;
  port: number;
  host: string;
  proxy: string | undefined;
  outputFormat: OutputFormat;
  skipImageDownloads: boolean;
  imageDir: string;
  isStdioMode: boolean;
  configSources: Record<string, Source>;
}

/** Resolve a config value through the priority chain: CLI flag → env var → default. */
export function resolve<T>(flag: T | undefined, env: T | undefined, fallback: T): Resolved<T> {
  if (flag !== undefined) return { value: flag, source: "cli" };
  if (env !== undefined) return { value: env, source: "env" };
  return { value: fallback, source: "default" };
}

export function envStr(name: string): string | undefined {
  return process.env[name] || undefined;
}

export function envInt(...names: string[]): number | undefined {
  for (const name of names) {
    const val = process.env[name];
    if (val) {
      const n = parseInt(val, 10);
      if (!isNaN(n)) return n;
    }
  }
  return undefined;
}

export function envBool(name: string): boolean | undefined {
  const val = process.env[name];
  if (val === "true") return true;
  if (val === "false") return false;
  return undefined;
}

// Throws on invalid input so callers control how the failure surfaces (the
// server entry point exits the process; the `fetch` CLI sets an exit code) and
// so the validators stay pure for library consumers.
export function parseOutputFormat(
  value: string | undefined,
  source: string,
): OutputFormat | undefined {
  if (value === undefined) return undefined;
  if (isOutputFormat(value)) return value;
  throw new Error(
    `Invalid ${source} value '${value}'. Expected one of: ${VALID_OUTPUT_FORMATS.join(", ")}`,
  );
}

function maskApiKey(key: string): string {
  if (!key || key.length <= 4) return "****";
  return `****${key.slice(-4)}`;
}

/**
 * Load an env file. An explicit `--env <path>` is always honored. Without one,
 * `./.env` is only picked up when `implicit` is set: HTTP mode and the `fetch`
 * CLI are run by a person from their own project, but a stdio server is
 * spawned by an MCP client with an arbitrary cwd — in a Blocks sandbox that is
 * the user's repository, whose `.env` must not be able to override the
 * credentials the host injected (`override: true` lets the file win).
 */
export function loadEnvFile(envPath: string | undefined, { implicit = true } = {}): string {
  const envFilePath = envPath ? resolvePath(envPath) : resolvePath(process.cwd(), ".env");
  if (envPath || implicit) {
    loadEnv({ path: envFilePath, override: true });
  }
  return envFilePath;
}

export const DEFAULT_OAUTH_TOKEN_FILE = "~/.config/figma/.oauth_token";

export type AuthFlags = {
  figmaApiKey?: string;
  figmaOauthToken?: string;
  figmaOauthTokenFile?: string;
};

/**
 * Where the token file lives. The flag wins, then `FIGMA_OAUTH_TOKEN_FILE`,
 * then the default path. Setting either to an empty string disables the file
 * lookup entirely (for hosts that want env-only credentials).
 */
function resolveTokenFilePath(flag: string | undefined): string | undefined {
  const raw = resolve(flag, process.env.FIGMA_OAUTH_TOKEN_FILE, DEFAULT_OAUTH_TOKEN_FILE).value;
  if (raw === "") return undefined;
  return raw.startsWith("~/") ? resolvePath(homedir(), raw.slice(2)) : resolvePath(raw);
}

function readTokenFile(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8").trim() || undefined;
  } catch {
    // Missing or unreadable is the normal case outside a Blocks sandbox.
    return undefined;
  }
}

/**
 * The server-default credential chain, evaluated on EVERY call (see
 * `CredentialSource`): token file → OAuth token (flag, then env) → personal
 * access token (flag, then env). The file comes first because it is the one
 * slot an external refresher keeps current; flags and env vars are the
 * startup snapshot and cannot change under a running process.
 */
export function createCredentialSource(flags: AuthFlags): CredentialSource {
  return (): FigmaCredential | undefined => {
    const filePath = resolveTokenFilePath(flags.figmaOauthTokenFile);
    const fileToken = filePath ? readTokenFile(filePath) : undefined;
    if (fileToken) return { kind: "oauth", token: fileToken, source: filePath! };

    if (flags.figmaOauthToken) {
      return { kind: "oauth", token: flags.figmaOauthToken, source: "--figma-oauth-token" };
    }
    const envOauth = envStr("FIGMA_OAUTH_TOKEN");
    if (envOauth) return { kind: "oauth", token: envOauth, source: "FIGMA_OAUTH_TOKEN" };

    if (flags.figmaApiKey) {
      return { kind: "pat", token: flags.figmaApiKey, source: "--figma-api-key" };
    }
    const envKey = envStr("FIGMA_API_KEY");
    if (envKey) return { kind: "pat", token: envKey, source: "FIGMA_API_KEY" };

    return undefined;
  };
}

/**
 * Thrown for user-fixable input errors (missing credentials, missing file key,
 * etc.). CLI entry points catch this and print the bare message with exit 1,
 * distinct from unexpected crashes that get a "Failed to start server:" prefix
 * and stack trace. Throwing (vs. process.exit) keeps validators pure and safe
 * for library consumers of `~/mcp-server`.
 */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

/**
 * Fail fast when global credentials are required but missing. HTTP mode skips
 * this check so it can accept per-request `X-Figma-Token` headers; stdio and
 * the `fetch` CLI have no way to receive request-time auth and must have
 * something resolvable at startup or they'd just defer the failure to the
 * first tool call with a misleading "send X-Figma-Token" message.
 */
export function requireGlobalCredentials(credentials: CredentialSource): void {
  if (credentials()) return;
  throw new UsageError(
    `Either FIGMA_API_KEY or FIGMA_OAUTH_TOKEN is required (via CLI argument, environment variable, .env file, or a token file at ${DEFAULT_OAUTH_TOKEN_FILE})`,
  );
}

export function getServerConfig(flags: ServerFlags): ServerConfig {
  const isStdioMode = flags.stdio === true;

  // Load .env before resolving env-backed values
  const envFilePath = loadEnvFile(flags.env, { implicit: !isStdioMode });
  const envFileSource: Source = flags.env !== undefined ? "cli" : "default";

  // Auth
  const auth = createCredentialSource(flags);

  // Resolve config values: CLI flag → env var → default
  const figmaApiKey = resolve(flags.figmaApiKey, envStr("FIGMA_API_KEY"), "");
  const figmaOauthToken = resolve(flags.figmaOauthToken, envStr("FIGMA_OAUTH_TOKEN"), "");
  const figmaOauthTokenFile = resolve(
    flags.figmaOauthTokenFile,
    envStr("FIGMA_OAUTH_TOKEN_FILE"),
    DEFAULT_OAUTH_TOKEN_FILE,
  );
  const port = resolve(flags.port, envInt("FRAMELINK_PORT", "PORT"), 3333);
  const host = resolve(flags.host, envStr("FRAMELINK_HOST"), "127.0.0.1");
  const skipImageDownloads = resolve(
    flags.skipImageDownloads,
    envBool("SKIP_IMAGE_DOWNLOADS"),
    false,
  );
  const envImageDir = envStr("IMAGE_DIR");
  const imageDir = resolve(
    flags.imageDir ? resolvePath(flags.imageDir) : undefined,
    envImageDir ? resolvePath(envImageDir) : undefined,
    process.cwd(),
  );

  // Only resolve explicit proxy config here. Standard env vars (HTTPS_PROXY, HTTP_PROXY,
  // NO_PROXY) are handled by undici's EnvHttpProxyAgent at the dispatcher level, which
  // correctly respects NO_PROXY exclusions.
  const proxy = resolve(flags.proxy, envStr("FIGMA_PROXY"), undefined);

  // --format wins; --json is a back-compat alias for --format=json. Invalid
  // user-supplied values fail loudly at startup rather than silently coercing.
  const formatFromFlag =
    parseOutputFormat(flags.format, "--format") ?? (flags.json ? "json" : undefined);
  const formatFromEnv = parseOutputFormat(envStr("OUTPUT_FORMAT"), "OUTPUT_FORMAT");
  const outputFormat = resolve<OutputFormat>(formatFromFlag, formatFromEnv, "tree");

  const configSources: Record<string, Source> = {
    envFile: envFileSource,
    figmaApiKey: figmaApiKey.source,
    figmaOauthToken: figmaOauthToken.source,
    figmaOauthTokenFile: figmaOauthTokenFile.source,
    port: port.source,
    host: host.source,
    proxy: proxy.source,
    outputFormat: outputFormat.source,
    skipImageDownloads: skipImageDownloads.source,
    imageDir: imageDir.source,
  };

  if (!isStdioMode) {
    console.log("\nConfiguration:");
    console.log(`- ENV_FILE: ${envFilePath} (source: ${configSources.envFile})`);
    // Startup snapshot only — the chain is re-evaluated on every request.
    const credential = auth();
    console.log(
      `- FIGMA_OAUTH_TOKEN_FILE: ${figmaOauthTokenFile.value || "(disabled)"} (source: ${configSources.figmaOauthTokenFile})`,
    );
    if (credential?.kind === "oauth") {
      console.log(`- OAuth token: ${maskApiKey(credential.token)} (source: ${credential.source})`);
      console.log("- Authentication Method: OAuth Bearer Token");
    } else if (credential) {
      console.log(`- API key: ${maskApiKey(credential.token)} (source: ${credential.source})`);
      console.log("- Authentication Method: Personal Access Token (X-Figma-Token)");
    } else {
      console.log("- Authentication Method: Per-request X-Figma-Token header");
    }
    console.log(`- FRAMELINK_PORT: ${port.value} (source: ${configSources.port})`);
    console.log(`- FRAMELINK_HOST: ${host.value} (source: ${configSources.host})`);
    console.log(`- PROXY: ${proxy.value ? "configured" : "none"} (source: ${configSources.proxy})`);
    console.log(`- OUTPUT_FORMAT: ${outputFormat.value} (source: ${configSources.outputFormat})`);
    console.log(
      `- SKIP_IMAGE_DOWNLOADS: ${skipImageDownloads.value} (source: ${configSources.skipImageDownloads})`,
    );
    console.log(`- IMAGE_DIR: ${imageDir.value} (source: ${configSources.imageDir})`);
    console.log();
  }

  return {
    auth,
    port: port.value,
    host: host.value,
    proxy: proxy.value,
    outputFormat: outputFormat.value,
    skipImageDownloads: skipImageDownloads.value,
    imageDir: imageDir.value,
    isStdioMode,
    configSources,
  };
}
