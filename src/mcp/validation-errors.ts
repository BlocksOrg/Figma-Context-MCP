import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

/**
 * The MCP SDK validates tool input against the registered zod schema BEFORE
 * calling our handler, and reports failures as "MCP error -32602: Input
 * validation error: Invalid arguments for tool ...: [{...JSON...}]" — noise an
 * LLM rarely recovers from. We monkey-patch the McpServer instance's
 * `validateToolInput` (private SDK API) to rethrow the first issue as a clean
 * "Invalid <field>: <message>" the model can act on.
 *
 * Patched per instance (not on the prototype) so concurrent McpServer
 * instances in HTTP mode each own their copy.
 *
 * Hardening notes:
 * - Fails open if `validateToolInput` ever disappears from the SDK — a noisier
 *   message is preferable to crashing the server during creation.
 * - The second parse (used to extract the structured issue) runs inside its
 *   own try/catch so a future schema with side-effecting refinements can't
 *   corrupt the SDK's normal error response.
 * - Prefers `safeParseAsync` so async-aware schemas don't throw on sync parse.
 */
export function installFriendlyValidationErrors(server: McpServer): void {
  type SafeParseResult = { success: boolean; error?: { issues?: ZodIssue[] } };
  type ValidatableSchema = {
    safeParse?: (args: unknown) => SafeParseResult;
    safeParseAsync?: (args: unknown) => Promise<SafeParseResult>;
  };
  type ValidatedTool = { inputSchema?: ValidatableSchema };
  type Patchable = {
    validateToolInput?: (tool: ValidatedTool, args: unknown, toolName: string) => Promise<unknown>;
  };

  const patchable = server as unknown as Patchable;
  if (typeof patchable.validateToolInput !== "function") {
    return;
  }
  const original = patchable.validateToolInput.bind(server);

  patchable.validateToolInput = async (tool, args, toolName) => {
    try {
      return await original(tool, args, toolName);
    } catch (error) {
      if (error instanceof McpError && error.code === ErrorCode.InvalidParams) {
        const issue = await extractIssue(tool, args);
        // The SDK's createToolError uses error.message regardless of error
        // type, so a plain Error works fine here.
        if (issue) {
          throw new Error(`Invalid ${normalizeFieldPath(issue.path)}: ${issue.message}`);
        }
      }
      throw error;
    }
  };
}

type ZodIssue = {
  path?: Array<string | number>;
  code?: string;
  message?: string;
};

/**
 * Best-effort structured issue extraction. Prefers `safeParseAsync` to align
 * with how the SDK validates — async schemas (refinements/transforms) need it.
 */
async function extractIssue(
  tool: {
    inputSchema?: {
      safeParse?: (args: unknown) => { success: boolean; error?: { issues?: ZodIssue[] } };
      safeParseAsync?: (
        args: unknown,
      ) => Promise<{ success: boolean; error?: { issues?: ZodIssue[] } }>;
    };
  },
  args: unknown,
): Promise<ZodIssue | undefined> {
  try {
    const schema = tool.inputSchema;
    if (schema?.safeParseAsync) {
      const result = await schema.safeParseAsync(args);
      if (!result.success) return result.error?.issues?.[0];
    } else if (schema?.safeParse) {
      const result = schema.safeParse(args);
      if (!result.success) return result.error?.issues?.[0];
    }
  } catch {
    // The second parse can throw if a future schema has side-effecting
    // refinements. Falling back loses field precision but keeps the SDK's
    // normal error response intact for the client.
  }
  return undefined;
}

/**
 * Render a zod error path with array indexes collapsed to `[]`, so the message
 * names the field (`nodes[].nodeId`) rather than one row of it.
 */
export function normalizeFieldPath(path: Array<string | number> | undefined): string {
  if (!path || path.length === 0) return "(root)";
  let out = "";
  for (const segment of path) {
    if (typeof segment === "number") {
      out += "[]";
    } else {
      out += out.length > 0 ? "." + segment : segment;
    }
  }
  return out;
}
