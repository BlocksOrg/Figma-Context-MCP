import { z } from "zod";
import { compact, fileKeyParam, runSimpleTool, type SimpleTool } from "./simple-tool.js";

const parametersSchema = z.object({ fileKey: fileKeyParam });

export const getFigmaFileVersionsTool: SimpleTool<z.infer<typeof parametersSchema>> = {
  name: "get_figma_file_versions",
  title: "Get Figma File Versions",
  description:
    "List a Figma file's version history (newest first): version id, when and by whom it was saved, and its label/description when it was named.",
  parametersSchema,
  handler: ({ fileKey }, figmaService) =>
    runSimpleTool("get_figma_file_versions", async () => {
      const { versions, pagination } = await figmaService.getFileVersions(fileKey);
      return compact({
        versions: versions.map((version) =>
          compact({
            id: version.id,
            created_at: version.created_at,
            author: version.user.handle,
            label: version.label,
            description: version.description,
          }),
        ),
        has_more: pagination?.next_page ? true : undefined,
      });
    }),
};
