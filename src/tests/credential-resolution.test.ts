import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCredentialSource } from "~/config.js";
import { FigmaService } from "~/services/figma.js";

/**
 * The server-default credential chain is re-evaluated on every request so an
 * externally refreshed OAuth token (Figma keeps one live token per app per
 * user) is picked up without a restart. These tests drive the real
 * FigmaService request path with `fetch` mocked at the network boundary.
 */

const figmaFileResponse = {
  name: "Test File",
  lastModified: "2026-01-01T00:00:00Z",
  thumbnailUrl: "",
  version: "1",
  document: { id: "0:0", name: "Document", type: "DOCUMENT", children: [] },
  components: {},
  componentSets: {},
  schemaVersion: 0,
  styles: {},
};

const unauthorized = () =>
  Response.json({ status: 401, err: "Invalid token" }, { status: 401, statusText: "Unauthorized" });

describe("per-request credential resolution", () => {
  let tokenFile: string;
  let fetchMock: ReturnType<typeof vi.fn>;

  function stubFetch(respond: (headers: Record<string, string>) => Response) {
    fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      respond((init?.headers as Record<string, string>) ?? {}),
    );
    vi.stubGlobal("fetch", fetchMock);
  }

  function authHeaderOfCall(index: number): string | undefined {
    const init = fetchMock.mock.calls[index][1] as RequestInit & {
      headers?: Record<string, string>;
    };
    return init.headers?.Authorization ?? init.headers?.["X-Figma-Token"];
  }

  beforeEach(() => {
    tokenFile = join(mkdtempSync(join(tmpdir(), "mcp-figma-token-")), ".oauth_token");
    vi.stubEnv("FIGMA_OAUTH_TOKEN_FILE", tokenFile);
    vi.stubEnv("FIGMA_OAUTH_TOKEN", "env-oauth-token");
    vi.stubEnv("FIGMA_API_KEY", "env-api-key");
    stubFetch(() => Response.json(figmaFileResponse));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("prefers the token file over FIGMA_OAUTH_TOKEN and FIGMA_API_KEY", async () => {
    writeFileSync(tokenFile, "file-token\n");

    await new FigmaService(createCredentialSource({})).getRawFile("abc");

    expect(authHeaderOfCall(0)).toBe("Bearer file-token");
  });

  it("falls through to the env OAuth token when the file is missing or blank", async () => {
    writeFileSync(tokenFile, "   \n");

    await new FigmaService(createCredentialSource({})).getRawFile("abc");

    expect(authHeaderOfCall(0)).toBe("Bearer env-oauth-token");
  });

  it("picks up a rewritten token file between two calls without a restart", async () => {
    const service = new FigmaService(createCredentialSource({}));

    writeFileSync(tokenFile, "token-one");
    await service.getRawFile("abc");
    writeFileSync(tokenFile, "token-two");
    await service.getRawFile("abc");

    expect(authHeaderOfCall(0)).toBe("Bearer token-one");
    expect(authHeaderOfCall(1)).toBe("Bearer token-two");
  });

  it("retries once with the re-read token when a 401 coincides with a rotation", async () => {
    writeFileSync(tokenFile, "stale-token");
    stubFetch((headers) => {
      if (headers.Authorization === "Bearer stale-token") {
        // The refresher lands the new token while the stale request is in flight.
        writeFileSync(tokenFile, "rotated-token");
        return unauthorized();
      }
      return Response.json(figmaFileResponse);
    });

    const result = await new FigmaService(createCredentialSource({})).getRawFile("abc");

    expect(result.data.name).toBe("Test File");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(authHeaderOfCall(1)).toBe("Bearer rotated-token");
  });

  it("does not retry an unchanged token and explains what the agent can do", async () => {
    writeFileSync(tokenFile, "revoked-token");
    stubFetch(() => unauthorized());

    const error = await new FigmaService(createCredentialSource({}))
      .getRawFile("abc")
      .catch((e: Error) => e);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain("401");
    expect(message).toContain("rotated or revoked");
    expect(message).toContain("get_new_figma_token");
    expect(message).toContain("live access token per app per user");
    expect(message).toContain(tokenFile);
    expect(message).not.toContain("revoked-token");
  });

  it("gives up after a second 401 on the rotated token", async () => {
    writeFileSync(tokenFile, "stale-token");
    stubFetch((headers) => {
      if (headers.Authorization === "Bearer stale-token") writeFileSync(tokenFile, "also-bad");
      return unauthorized();
    });

    const error = await new FigmaService(createCredentialSource({}))
      .getRawFile("abc")
      .catch((e: Error) => e);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((error as Error).message).toContain("re-read after the first 401");
  });
});
