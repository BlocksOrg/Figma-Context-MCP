import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FigmaService, type CredentialSource, type FigmaAuthOptions } from "../services/figma.js";
import { Logger } from "../utils/logger.js";
import type { OutputFormat } from "~/utils/serialize.js";
import { installFriendlyValidationErrors } from "./validation-errors.js";
import type { ToolExtra } from "./progress.js";
import {
  downloadFigmaImagesTool,
  getFigmaDataTool,
  type DownloadImagesParams,
  type GetFigmaDataParams,
} from "./tools/index.js";

const serverInfo = {
  name: "Figma MCP Server",
  version: process.env.NPM_PACKAGE_VERSION ?? "unknown",
  description:
    "Gives AI coding agents access to Figma design data, providing layout, styling, and content information for implementing designs.",
};

type ServerTransport = "stdio" | "http";

export type CreateServerOptions = {
  transport: ServerTransport;
  outputFormat?: OutputFormat;
  skipImageDownloads?: boolean;
  imageDir?: string;
};

function createServer(
  authOptions: FigmaAuthOptions | CredentialSource,
  { transport, outputFormat = "tree", skipImageDownloads = false, imageDir }: CreateServerOptions,
) {
  const server = new McpServer(serverInfo);
  const figmaService = new FigmaService(authOptions);

  registerTools(server, figmaService, { outputFormat, skipImageDownloads, imageDir });
  installFriendlyValidationErrors(server);

  Logger.isHTTP = transport !== "stdio";

  return server;
}

type RegisterToolsOptions = {
  outputFormat: OutputFormat;
  skipImageDownloads: boolean;
  imageDir?: string;
};

function registerTools(
  server: McpServer,
  figmaService: FigmaService,
  options: RegisterToolsOptions,
): void {
  server.registerTool(
    getFigmaDataTool.name,
    {
      title: "Get Figma Data",
      description: getFigmaDataTool.description,
      inputSchema: getFigmaDataTool.parametersSchema,
      annotations: { readOnlyHint: true },
    },
    (params: GetFigmaDataParams, extra: ToolExtra) =>
      getFigmaDataTool.handler(params, figmaService, options.outputFormat, extra),
  );

  if (!options.skipImageDownloads) {
    server.registerTool(
      downloadFigmaImagesTool.name,
      {
        title: "Download Figma Images",
        description: downloadFigmaImagesTool.getDescription(options.imageDir),
        inputSchema: downloadFigmaImagesTool.parametersSchema,
        annotations: { openWorldHint: true },
      },
      (params: DownloadImagesParams, extra: ToolExtra) =>
        downloadFigmaImagesTool.handler(params, figmaService, options.imageDir, extra),
    );
  }
}

export { createServer };
