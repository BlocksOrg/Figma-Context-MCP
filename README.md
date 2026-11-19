<a href="https://www.framelink.ai/?utm_source=github&utm_medium=referral&utm_campaign=readme" target="_blank" rel="noopener">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://www.framelink.ai/github/HeaderDark.png" />
    <img alt="Framelink" src="https://www.framelink.ai/github/HeaderLight.png" />
  </picture>
</a>

<div align="center">
  <h1>Framelink MCP for Figma</h1>
  <h3>Give your coding agent access to your Figma data.<br/>Implement designs in any framework in one-shot.</h3>
  <a href="https://www.npmjs.com/package/@blocksuser/figma-mcp">
    <img alt="npm" src="https://img.shields.io/npm/v/@blocksuser/figma-mcp.svg">
  </a>
  <a href="https://github.com/BlocksOrg/Figma-Context-MCP/blob/main/LICENSE">
    <img alt="MIT License" src="https://img.shields.io/github/license/BlocksOrg/Figma-Context-MCP" />
  </a>
  <a href="https://framelink.ai/discord">
    <img alt="Discord" src="https://img.shields.io/discord/1352337336913887343?color=7389D8&label&logo=discord&logoColor=ffffff" />
  </a>
  <br />
  <a href="https://twitter.com/glipsman">
    <img alt="Twitter" src="https://img.shields.io/twitter/url?url=https%3A%2F%2Fx.com%2Fglipsman&label=%40glipsman" />
  </a>
</div>

<br/>

## Blocks fork

This is the [Blocks](https://blocks.team) fork of [GLips/Figma-Context-MCP](https://github.com/GLips/Figma-Context-MCP) (Framelink MCP for Figma), published as [`@blocksuser/figma-mcp`](https://www.npmjs.com/package/@blocksuser/figma-mcp). Blocks runs this server inside agent sandboxes, which needs three things upstream does not provide:

- **Hardened dependency tree.** `pnpm audit --prod --audit-level=high` is a CI gate (111 advisories at fork time, 0 now) and dependabot keeps it that way. A tombstone test keeps `child_process` out of `src/` (CVE-2025-53967 / CVE-2025-15061).
- **No telemetry.** This fork sends no telemetry; the PostHog client and its opt-out variables are gone.
- **Per-request credential resolution.** The Figma token is re-read from a file on every request and a `401` is retried once with a rotated token, so a platform-refreshed OAuth token works without restarting the server (see [Authentication](#authentication)). The stdio server also no longer reads `.env` from its working directory.

Everything else — the tools, the simplified design format, the CLI — is upstream's, and upstream fixes are merged in periodically:

```bash
git remote add upstream https://github.com/GLips/Figma-Context-MCP.git
git fetch upstream && git merge upstream/main
```

The fork also adds five small read-only tools over the Figma REST API, next to upstream's `get_figma_data` and `download_figma_images`: `whoami`, `get_figma_comments`, `get_figma_file_versions`, `get_figma_dev_resources` and `get_figma_components_and_styles`. Each returns a lean YAML projection of the response; there are no write tools.

Install for an MCP client: `npx -y @blocksuser/figma-mcp --stdio`. Issues with the fork go to [BlocksOrg/Figma-Context-MCP](https://github.com/BlocksOrg/Figma-Context-MCP/issues); upstream's docs at [framelink.ai](https://www.framelink.ai/docs) still describe the tools.

Give [Cursor](https://cursor.sh/) and other AI-powered coding tools access to your Figma files with this [Model Context Protocol](https://modelcontextprotocol.io/introduction) server.

When Cursor has access to Figma design data, it's **way** better at one-shotting designs accurately than alternative approaches like pasting screenshots.

<h3><a href="https://www.framelink.ai/docs/quickstart?utm_source=github&utm_medium=referral&utm_campaign=readme">See quickstart instructions →</a></h3>

## Demo

[Watch a demo of building a UI in Cursor with Figma design data](https://youtu.be/6G9yb-LrEqg)

[![Watch the video](https://img.youtube.com/vi/6G9yb-LrEqg/maxresdefault.jpg)](https://youtu.be/6G9yb-LrEqg)

## How it works

1. Open your IDE's chat (e.g. agent mode in Cursor).
2. Paste a link to a Figma file, frame, or group.
3. Ask Cursor to do something with the Figma file—e.g. implement the design.
4. Cursor will fetch the relevant metadata from Figma and use it to write your code.

This MCP server is specifically designed for use with Cursor. Before responding with context from the [Figma API](https://www.figma.com/developers/api), it simplifies and translates the response so only the most relevant layout and styling information is provided to the model.

Reducing the amount of context provided to the model helps make the AI more accurate and the responses more relevant.

## Getting Started

Many code editors and other AI clients use a configuration file to manage MCP servers.

The `@blocksuser/figma-mcp` server can be configured by adding the following to your configuration file.

> NOTE: You will need to create a Figma access token to use this server. Instructions on how to create a Figma API access token can be found [here](https://help.figma.com/hc/en-us/articles/8085703771159-Manage-personal-access-tokens).

### MacOS / Linux

```json
{
  "mcpServers": {
    "Framelink MCP for Figma": {
      "command": "npx",
      "args": ["-y", "@blocksuser/figma-mcp", "--figma-api-key=YOUR-KEY", "--stdio"]
    }
  }
}
```

### Windows

```json
{
  "mcpServers": {
    "Framelink MCP for Figma": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "@blocksuser/figma-mcp", "--figma-api-key=YOUR-KEY", "--stdio"]
    }
  }
}
```

Or you can set `FIGMA_API_KEY` and `PORT` in the `env` field.

If you need more information on how to configure the Framelink MCP for Figma, see the [Framelink docs](https://www.framelink.ai/docs/quickstart?utm_source=github&utm_medium=referral&utm_campaign=readme).

## Authentication

The server resolves its Figma credential **on every request**, in this order:

| Priority | Source                                                                                                                                                                                                             | Sent as                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| 1        | Token file: `--figma-oauth-token-file` / `FIGMA_OAUTH_TOKEN_FILE`, default `~/.config/figma/.oauth_token` (trimmed; a missing or empty file is skipped; set the variable to an empty string to disable the lookup) | `Authorization: Bearer` |
| 2        | `--figma-oauth-token` / `FIGMA_OAUTH_TOKEN`                                                                                                                                                                        | `Authorization: Bearer` |
| 3        | `--figma-api-key` / `FIGMA_API_KEY` (personal access token)                                                                                                                                                        | `X-Figma-Token`         |

In HTTP mode a per-request `Authorization: Bearer …` or `X-Figma-Token` header overrides all of the above for that request.

Why per request: Figma keeps **one live access token per app per user**, so whenever an OAuth token is refreshed the previous one stops working. A platform that refreshes tokens for you (Blocks does, writing the current token to the token file) therefore invalidates whatever a long-running server read at startup. Re-reading the file per request means a rotated token is used without a restart, and on a `401` the server re-resolves the credential once more and retries once if it changed. If the token is unchanged, or the retry is rejected too, the tool returns an error that says so and tells the agent to fetch the current token (the `get_new_figma_token` tool inside Blocks) or wait up to a minute for the refreshed one to land.

In stdio mode the server does not read a `.env` file from its working directory (an MCP client spawns it with an arbitrary cwd); pass `--env <path>` to load one explicitly. HTTP mode and the `fetch` subcommand still load `./.env`.

## Learn More

The Framelink MCP for Figma is simple but powerful. Get the most out of it by learning more at the [Framelink](https://framelink.ai?utm_source=github&utm_medium=referral&utm_campaign=readme) site.
