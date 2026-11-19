import { type Command, command } from "cleye";
import {
  createCredentialSource,
  loadEnvFile,
  parseOutputFormat,
  requireGlobalCredentials,
  UsageError,
} from "~/config.js";
import { FigmaService } from "~/services/figma.js";
import { parseFigmaUrl } from "~/utils/figma-url.js";
import { getFigmaData } from "~/services/get-figma-data.js";
import type { OutputFormat } from "~/utils/serialize.js";

export const fetchCommand: Command = command(
  {
    name: "fetch",
    description: "Fetch simplified Figma data and print to stdout",
    parameters: ["[url]"],
    flags: {
      fileKey: {
        type: String,
        description: "Figma file key (overrides URL)",
      },
      nodeId: {
        type: String,
        description: "Node ID, format 1234:5678 (overrides URL)",
      },
      depth: {
        type: Number,
        description: "Tree traversal depth",
      },
      json: {
        type: Boolean,
        description: "Output JSON instead of YAML. Back-compat alias for --format=json.",
      },
      format: {
        type: String,
        description: "Output format: yaml (default), json, or tree.",
      },
      figmaApiKey: {
        type: String,
        description: "Figma API key",
      },
      figmaOauthToken: {
        type: String,
        description: "Figma OAuth token",
      },
      figmaOauthTokenFile: {
        type: String,
        description: "File holding a Figma OAuth token (default ~/.config/figma/.oauth_token)",
      },
      env: {
        type: String,
        description: "Path to .env file",
      },
    },
  },
  (argv) => {
    run(argv.flags, argv._).catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
  },
);

async function run(
  flags: {
    fileKey?: string;
    nodeId?: string;
    depth?: number;
    json?: boolean;
    format?: string;
    figmaApiKey?: string;
    figmaOauthToken?: string;
    figmaOauthTokenFile?: string;
    env?: string;
  },
  positionals: string[],
) {
  const url = positionals[0];
  let fileKey = flags.fileKey;
  let nodeId = flags.nodeId;

  if (url) {
    try {
      const parsed = parseFigmaUrl(url);
      fileKey ??= parsed.fileKey;
      nodeId ??= parsed.nodeId;
    } catch (error) {
      if (!fileKey) throw error;
      // fileKey provided via flag — malformed URL is non-fatal
    }
  }

  if (!fileKey) {
    throw new UsageError("Either a Figma URL or --file-key is required");
  }

  loadEnvFile(flags.env);
  const credentials = createCredentialSource(flags);
  // The fetch CLI has no per-request credential channel (unlike HTTP mode).
  // Fail fast so the user gets an actionable error instead of an HTTP-shaped
  // one from the request path.
  requireGlobalCredentials(credentials);

  // The fetch CLI stays yaml-by-default (unlike the MCP server, which defaults
  // to tree): its output is piped into standard tooling (`> out.yaml`, `| jq`),
  // where tree's bespoke indented format isn't parseable. Tree's token-efficiency
  // win is for LLM consumers, not shell pipelines.
  const outputFormat: OutputFormat =
    parseOutputFormat(flags.format, "--format") ?? (flags.json ? "json" : "yaml");

  const result = await getFigmaData(
    new FigmaService(credentials),
    { fileKey, nodeId, depth: flags.depth },
    outputFormat,
  );
  console.log(result.formatted);
}
