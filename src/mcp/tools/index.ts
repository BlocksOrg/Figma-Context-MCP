export { getFigmaDataTool } from "./get-figma-data-tool.js";
export { downloadFigmaImagesTool } from "./download-figma-images-tool.js";
export type { DownloadImagesParams } from "./download-figma-images-tool.js";
export type { GetFigmaDataParams } from "./get-figma-data-tool.js";

import { getFigmaCommentsTool } from "./get-figma-comments-tool.js";
import { getFigmaComponentsAndStylesTool } from "./get-figma-components-and-styles-tool.js";
import { getFigmaDevResourcesTool } from "./get-figma-dev-resources-tool.js";
import { getFigmaFileVersionsTool } from "./get-figma-file-versions-tool.js";
import type { SimpleTool } from "./simple-tool.js";
import { whoamiTool } from "./whoami-tool.js";

/** Read-only REST tools with the uniform `SimpleTool` contract, mounted in a loop. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const simpleTools: ReadonlyArray<SimpleTool<any>> = [
  whoamiTool,
  getFigmaCommentsTool,
  getFigmaFileVersionsTool,
  getFigmaDevResourcesTool,
  getFigmaComponentsAndStylesTool,
];
