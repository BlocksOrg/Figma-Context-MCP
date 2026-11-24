# Release

Publish a new `@blocksuser/figma-mcp` release to npm.

## Steps

1. **Decide the bump** from what landed on `main` since the last tag:
   `git log $(git describe --tags --abbrev=0)..origin/main --oneline` (or
   `gh release view --repo BlocksOrg/Figma-Context-MCP` for the previous release). Conventional
   prefixes map to the bump: `fix:` → patch, `feat:` → minor, breaking change → major.

2. **Confirm with the user** via AskUserQuestion: "Run the Publish workflow with bump `<type>`
   (v<current> → v<next>)?" Never dispatch without confirmation — it publishes to the public
   registry and cannot be unpublished after 72 h.

3. **Dispatch the workflow:**
   `gh workflow run publish.yml --repo BlocksOrg/Figma-Context-MCP -f version=<patch|minor|major>`
   then `gh run list --repo BlocksOrg/Figma-Context-MCP --workflow publish.yml --limit 1` and
   `gh run watch <id>`. The job type-checks, tests, builds, bumps `package.json` + `server.json`,
   pushes `chore: release vX.Y.Z` + tag, creates the GitHub Release (generated notes) and runs
   `pnpm publish --access public` with the `NPM_TOKEN` secret.

4. **Verify:** `npm view @blocksuser/figma-mcp version` shows the new version and
   `gh release view vX.Y.Z --repo BlocksOrg/Figma-Context-MCP` exists.

5. **Downstream:** the sandbox images install the package from `dependencies/*.package.json` in
   BlocksOrg/agents (`"@blocksuser/figma-mcp": "^X.Y"`) — a major bump needs that range widened
   and a new agents revision deployed; minor/patch are picked up on the next image build.
