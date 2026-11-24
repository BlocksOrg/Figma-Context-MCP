import { z } from "zod";
import { compact, fileKeyParam, runSimpleTool, type SimpleTool } from "./simple-tool.js";

const parametersSchema = z.object({ fileKey: fileKeyParam });

export const getFigmaComponentsAndStylesTool: SimpleTool<z.infer<typeof parametersSchema>> = {
  name: "get_figma_components_and_styles",
  title: "Get Figma Components and Styles",
  description:
    "List the components and styles a Figma file publishes to its team library: keys, names, node IDs and descriptions. Use it to map a design onto an existing design system before fetching nodes.",
  parametersSchema,
  handler: ({ fileKey }, figmaService) =>
    runSimpleTool("get_figma_components_and_styles", async () => {
      const [components, styles] = await Promise.all([
        figmaService.getPublishedComponents(fileKey),
        figmaService.getPublishedStyles(fileKey),
      ]);
      return {
        components: components.meta.components.map((component) =>
          compact({
            key: component.key,
            name: component.name,
            node_id: component.node_id,
            page: component.containing_frame?.pageName,
            description: component.description,
          }),
        ),
        styles: styles.meta.styles.map((style) =>
          compact({
            key: style.key,
            name: style.name,
            type: style.style_type,
            node_id: style.node_id,
            description: style.description,
          }),
        ),
      };
    }),
};
