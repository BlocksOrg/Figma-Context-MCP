import { z } from "zod";
import { fileKeyParam, nodeIdParam, runSimpleTool, type SimpleTool } from "./simple-tool.js";

const parametersSchema = z.object({
  fileKey: fileKeyParam,
  nodeIds: z
    .array(nodeIdParam)
    .optional()
    .describe("Restrict to these node IDs. Omit to list every dev resource in the file."),
});

export const getFigmaDevResourcesTool: SimpleTool<z.infer<typeof parametersSchema>> = {
  name: "get_figma_dev_resources",
  title: "Get Figma Dev Resources",
  description:
    "List the dev resources (links to code, docs, tickets) attached to nodes in a Figma file.",
  parametersSchema,
  handler: ({ fileKey, nodeIds }, figmaService) =>
    runSimpleTool("get_figma_dev_resources", async () => {
      const { dev_resources } = await figmaService.getDevResources(fileKey, nodeIds);
      return {
        dev_resources: dev_resources.map(({ id, name, url, node_id }) => ({
          id,
          node_id,
          name,
          url,
        })),
      };
    }),
};
