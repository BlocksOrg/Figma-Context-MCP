import { z } from "zod";
import { compact, runSimpleTool, type SimpleTool } from "./simple-tool.js";

const parametersSchema = z.object({});

export const whoamiTool: SimpleTool<z.infer<typeof parametersSchema>> = {
  name: "whoami",
  title: "Who am I",
  description:
    "Identify the Figma account the server is authenticated as (id, handle, email). Use it to check which account's files are reachable before fetching.",
  parametersSchema,
  handler: (_params, figmaService) =>
    runSimpleTool("whoami", async () => {
      const me = await figmaService.getMe();
      return compact({ id: me.id, handle: me.handle, email: me.email });
    }),
};
