import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import yaml from "js-yaml";
import { createServer } from "~/mcp/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * The small REST tools exist to hand the model a lean projection of Figma's
 * verbose responses. These tests pin that projection end-to-end through the
 * MCP layer with `fetch` mocked at the network boundary.
 */
const user = { id: "u1", handle: "ada", img_url: "https://img/ada.png" };

const responses: Record<string, unknown> = {
  "/v1/me": { ...user, email: "ada@example.com" },
  "/v1/files/abc/comments": {
    comments: [
      {
        id: "c1",
        file_key: "abc",
        client_meta: { node_id: "1:2", node_offset: { x: 0, y: 0 } },
        user,
        created_at: "2026-01-01T00:00:00Z",
        resolved_at: "2026-01-02T00:00:00Z",
        message: "Make it pop",
        order_id: "1",
        reactions: [{ user, emoji: ":+1:", created_at: "2026-01-01T00:00:00Z" }],
      },
      {
        id: "c2",
        parent_id: "c1",
        file_key: "abc",
        client_meta: { x: 1, y: 2 },
        user,
        created_at: "2026-01-03T00:00:00Z",
        resolved_at: null,
        message: "Done",
        order_id: null,
        reactions: [],
      },
    ],
  },
  "/v1/files/abc/components": {
    status: 200,
    error: false,
    meta: {
      components: [
        {
          key: "k1",
          file_key: "abc",
          node_id: "3:4",
          name: "Button",
          description: "",
          created_at: "",
          updated_at: "",
          user,
          containing_frame: { pageId: "0:1", pageName: "Components" },
        },
      ],
    },
  },
  "/v1/files/abc/styles": {
    status: 200,
    error: false,
    meta: {
      styles: [
        {
          key: "s1",
          file_key: "abc",
          node_id: "5:6",
          style_type: "FILL",
          name: "Brand/Primary",
          description: "Main brand color",
          created_at: "",
          updated_at: "",
          user,
        },
      ],
    },
  },
};

describe("read-only REST tools", () => {
  let client: Client;
  let server: McpServer;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      const body = responses[path];
      return body ? Response.json(body) : new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    server = createServer(
      { figmaApiKey: "test-key", figmaOAuthToken: "", useOAuth: false },
      { transport: "stdio" },
    );
    client = new Client({ name: "rest-tools-test", version: "1.0.0" });
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientT), server.connect(serverT)]);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
    vi.unstubAllGlobals();
  });

  async function call(name: string, args: Record<string, unknown> = {}) {
    const result = await client.request(
      { method: "tools/call", params: { name, arguments: args } },
      CallToolResultSchema,
    );
    const first = result.content[0];
    const text = first?.type === "text" ? first.text : "";
    // Successful results are YAML dumped with JSON_SCHEMA (timestamps stay strings).
    const data = result.isError ? undefined : yaml.load(text, { schema: yaml.JSON_SCHEMA });
    return { isError: result.isError, text, data: data as Record<string, unknown> };
  }

  it("registers the five tools as read-only", async () => {
    const { tools } = await client.listTools();
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    for (const name of [
      "whoami",
      "get_figma_comments",
      "get_figma_file_versions",
      "get_figma_dev_resources",
      "get_figma_components_and_styles",
    ]) {
      expect(byName[name]?.annotations?.readOnlyHint).toBe(true);
    }
  });

  it("whoami answers with the account identity only", async () => {
    const { isError, data } = await call("whoami");

    expect(isError).toBeUndefined();
    expect(data).toEqual({ id: "u1", handle: "ada", email: "ada@example.com" });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ headers: { "X-Figma-Token": "test-key" } });
  });

  it("projects comments to author, pin, threading and text", async () => {
    const { data } = await call("get_figma_comments", { fileKey: "abc" });

    expect(data).toEqual({
      comments: [
        {
          id: "c1",
          node_id: "1:2",
          author: "ada",
          created_at: "2026-01-01T00:00:00Z",
          resolved: true,
          message: "Make it pop",
        },
        {
          id: "c2",
          parent_id: "c1",
          author: "ada",
          created_at: "2026-01-03T00:00:00Z",
          message: "Done",
        },
      ],
    });
  });

  it("merges published components and styles from both endpoints", async () => {
    const { data } = await call("get_figma_components_and_styles", { fileKey: "abc" });

    expect(data).toEqual({
      components: [{ key: "k1", name: "Button", node_id: "3:4", page: "Components" }],
      styles: [
        {
          key: "s1",
          name: "Brand/Primary",
          type: "FILL",
          node_id: "5:6",
          description: "Main brand color",
        },
      ],
    });
    const paths = fetchMock.mock.calls.map(([input]) => new URL(String(input)).pathname).sort();
    expect(paths).toEqual(["/v1/files/abc/components", "/v1/files/abc/styles"]);
  });

  it("returns a tool error, not a crash, when Figma rejects the request", async () => {
    const { isError, text } = await call("get_figma_file_versions", { fileKey: "nope" });

    expect(isError).toBe(true);
    expect(text).toContain("get_figma_file_versions failed");
  });
});
