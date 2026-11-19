import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "~/mcp/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * These tests cover the McpServer.validateToolInput monkey patch in
 * src/mcp/validation-errors.ts. They use a real Client/Server pair over
 * InMemoryTransport so the SDK validation path runs end-to-end — anything less
 * wouldn't catch SDK upgrades that change the validation signature.
 */
describe("friendly validation errors (monkey patch)", () => {
  let client: Client;
  let server: McpServer;

  beforeEach(async () => {
    server = createServer(
      { figmaApiKey: "test-key", figmaOAuthToken: "", useOAuth: false },
      { transport: "stdio" },
    );
    client = new Client({ name: "validation-test-client", version: "1.0.0" });
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientT), server.connect(serverT)]);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  async function callTool(name: string, args: Record<string, unknown>) {
    return client.request(
      { method: "tools/call", params: { name, arguments: args } },
      CallToolResultSchema,
    );
  }

  function textOf(result: Awaited<ReturnType<typeof callTool>>): string {
    const first = result.content[0];
    return first?.type === "text" ? first.text : "";
  }

  it("names the failing field when get_figma_data fileKey fails its regex", async () => {
    // McpServer catches the validation McpError and turns it into a tool
    // result with isError=true (rather than rejecting the JSON-RPC request).
    // Our monkey patch rewrites the message before that conversion.
    const result = await callTool("get_figma_data", { fileKey: "invalid-key!" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/^Invalid fileKey: File key must be alphanumeric/);
  });

  it("collapses array indexes to [] in nested field paths", async () => {
    const result = await callTool("download_figma_images", {
      fileKey: "abc123",
      nodes: [{ nodeId: "BAD!!!", fileName: "x.png" }],
      localPath: "images",
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/^Invalid nodes\[\]\.nodeId: Node ID must be like/);
  });
});
