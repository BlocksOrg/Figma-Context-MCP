// Re-export server-related functionality for users who want MCP server capabilities
export { createServer } from "./mcp/index.js";
export type { FigmaService } from "./services/figma.js";
export { staticCredentials } from "./services/figma.js";
export type { CredentialSource, FigmaAuthOptions, FigmaCredential } from "./services/figma.js";
export { createCredentialSource, getServerConfig, UsageError } from "./config.js";
export type { AuthFlags, ServerConfig } from "./config.js";
export { startServer, startHttpServer, stopHttpServer } from "./server.js";
