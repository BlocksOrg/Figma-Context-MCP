import { z } from "zod";
import type { FigmaService } from "~/services/figma.js";
import { Logger } from "~/utils/logger.js";
import { dumpYaml } from "~/utils/yaml-dump.js";

/**
 * The small read-only REST tools (whoami, comments, versions, dev resources,
 * published components/styles) share one shape: a few parameters, one or two
 * Figma calls, and a lean YAML projection of the response. Keeping them to
 * this contract lets `registerTools` mount them in a loop and keeps each tool
 * file to the part that is actually different — the projection.
 */
export type SimpleTool<Params> = {
  name: string;
  title: string;
  description: string;
  parametersSchema: z.ZodObject<z.ZodRawShape>;
  handler: (params: Params, figmaService: FigmaService) => Promise<ToolResult>;
};

export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: true;
};

export const fileKeyParam = z
  .string()
  .regex(/^[a-zA-Z0-9]+$/, "File key must be alphanumeric")
  .describe("The key of the Figma file, found in a URL like figma.com/(file|design)/<fileKey>/...");

/** Node IDs as the API spells them (`12:34`); the `-` URL spelling is accepted too. */
export const nodeIdParam = z
  .string()
  .regex(/^I?\d+[:|-]\d+(?:;\d+[:|-]\d+)*$/, "Node ID must be like '1234:5678'")
  .transform((id) => id.replace(/-/g, ":"));

/** Run a projection, rendering the result as YAML or the failure as a tool error. */
export async function runSimpleTool(
  label: string,
  project: () => Promise<unknown>,
): Promise<ToolResult> {
  try {
    const result = await project();
    return { content: [{ type: "text", text: dumpYaml(result) }] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    Logger.error(`Error in ${label}:`, message);
    return { isError: true, content: [{ type: "text", text: `${label} failed: ${message}` }] };
  }
}

/** Drop `undefined`, `null` and empty-string values so the YAML carries only what is set. */
export function compact<T extends Record<string, unknown>>(record: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(record).filter(
      ([, value]) => value !== undefined && value !== null && value !== "",
    ),
  ) as Partial<T>;
}
