import { z } from "zod";
import { compact, fileKeyParam, runSimpleTool, type SimpleTool } from "./simple-tool.js";

const parametersSchema = z.object({ fileKey: fileKeyParam });

export const getFigmaCommentsTool: SimpleTool<z.infer<typeof parametersSchema>> = {
  name: "get_figma_comments",
  title: "Get Figma Comments",
  description:
    "List the comments on a Figma file: author, text, the node they are pinned to, and reply threading (parent_id). Resolved comments are marked.",
  parametersSchema,
  handler: ({ fileKey }, figmaService) =>
    runSimpleTool("get_figma_comments", async () => {
      const { comments } = await figmaService.getComments(fileKey);
      return {
        comments: comments.map((comment) =>
          compact({
            id: comment.id,
            parent_id: comment.parent_id,
            // Only pinned comments carry a node; region-only pins have none.
            node_id: "node_id" in comment.client_meta ? comment.client_meta.node_id : undefined,
            author: comment.user.handle,
            created_at: comment.created_at,
            resolved: comment.resolved_at ? true : undefined,
            message: comment.message,
          }),
        ),
      };
    }),
};
