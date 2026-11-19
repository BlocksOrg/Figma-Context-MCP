import type {
  GetImagesResponse,
  GetFileResponse,
  GetFileNodesResponse,
  GetImageFillsResponse,
  Transform,
} from "@figma/rest-api-spec";
import { downloadAndProcessImage, type ImageProcessingResult } from "~/utils/image-processing.js";
import { Logger, writeLogs } from "~/utils/logger.js";
import { fetchJSON } from "~/utils/fetch-json.js";
import { getErrorMeta } from "~/utils/error-meta.js";
import {
  buildForbiddenMessage,
  buildRateLimitMessage,
  buildUnauthorizedMessage,
} from "./errors/index.js";

/**
 * A credential as used for one request. `source` names where it came from
 * (a file path, an env var, a flag, "HTTP request header") for logs and error
 * messages — never the token itself.
 */
export type FigmaCredential = {
  kind: "oauth" | "pat";
  token: string;
  source: string;
};

/**
 * Credentials are resolved per request, not per server: Figma keeps a single
 * live access token per app per user, so when the platform that issued an
 * OAuth token refreshes it, the copy this process read at startup dies. A
 * source is re-evaluated on every call (and again after a 401) so a rotated
 * token is picked up without a restart. Returning `undefined` means "nothing
 * configured" and fails the request before it is sent.
 */
export type CredentialSource = () => FigmaCredential | undefined;

/**
 * Fixed credentials: HTTP per-request headers, the test suite, and library
 * callers that already hold a token. `useOAuth` decides which header carries
 * `figmaOAuthToken`; an empty token falls through to the API key.
 */
export type FigmaAuthOptions = {
  figmaApiKey: string;
  figmaOAuthToken: string;
  useOAuth: boolean;
};

export function staticCredentials(auth: FigmaAuthOptions, source = "static"): CredentialSource {
  const credential: FigmaCredential | undefined =
    auth.useOAuth && auth.figmaOAuthToken
      ? { kind: "oauth", token: auth.figmaOAuthToken, source }
      : auth.figmaApiKey
        ? { kind: "pat", token: auth.figmaApiKey, source }
        : undefined;
  return () => credential;
}

export function toCredentialSource(auth: FigmaAuthOptions | CredentialSource): CredentialSource {
  return typeof auth === "function" ? auth : staticCredentials(auth);
}

type SvgOptions = {
  outlineText: boolean;
  includeId: boolean;
  simplifyStroke: boolean;
};

export class FigmaService {
  private readonly credentials: CredentialSource;
  private readonly baseUrl = "https://api.figma.com/v1";

  constructor(auth: FigmaAuthOptions | CredentialSource) {
    this.credentials = toCredentialSource(auth);
  }

  private requireCredential(): FigmaCredential {
    const credential = this.credentials();
    if (!credential) {
      throw new Error(
        "Figma API authentication is required. Configure FIGMA_API_KEY or FIGMA_OAUTH_TOKEN on the server, or send X-Figma-Token / Authorization: Bearer on the HTTP request.",
      );
    }
    return credential;
  }

  private authHeaders(credential: FigmaCredential): Record<string, string> {
    return credential.kind === "oauth"
      ? { Authorization: `Bearer ${credential.token}` }
      : { "X-Figma-Token": credential.token };
  }

  /**
   * Filters out null values from Figma image responses. This ensures we only work with valid image URLs.
   */
  private filterValidImages(
    images: { [key: string]: string | null } | undefined,
  ): Record<string, string> {
    if (!images) return {};
    return Object.fromEntries(Object.entries(images).filter(([, value]) => !!value)) as Record<
      string,
      string
    >;
  }

  private async request<T>(endpoint: string): Promise<T> {
    const { data } = await this.requestWithSize<T>(endpoint);
    return data;
  }

  /**
   * Like `request`, but also surfaces the raw response body size so callers
   * can report it in metrics. Only used by endpoints whose payload size we
   * care about (`getRawFile` / `getRawNode`); image-fetching endpoints
   * continue to use `request` unchanged.
   */
  private async requestWithSize<T>(endpoint: string): Promise<{ data: T; rawSize: number }> {
    const credential = this.requireCredential();
    try {
      return await this.send<T>(endpoint, credential);
    } catch (error) {
      if (getErrorMeta(error).http_status !== 401) {
        throw this.describeFailure(endpoint, error);
      }
      // A 401 is "this token is dead", and the usual reason is that it was
      // rotated: the issuer refreshed it (killing the old one — Figma keeps one
      // live token per app per user) and the new value has since landed in the
      // token file. Re-resolve; a changed token means exactly that race, so
      // retry once with it. An unchanged token is genuinely revoked — no retry.
      const fresh = this.credentials();
      if (!fresh || fresh.token === credential.token) {
        throw new Error(buildUnauthorizedMessage(endpoint, credential, error), { cause: error });
      }
      Logger.log(`Figma token from ${fresh.source} changed since the 401; retrying once`);
      try {
        return await this.send<T>(endpoint, fresh);
      } catch (retryError) {
        if (getErrorMeta(retryError).http_status === 401) {
          throw new Error(
            buildUnauthorizedMessage(endpoint, fresh, retryError, { retried: true }),
            {
              cause: retryError,
            },
          );
        }
        throw this.describeFailure(endpoint, retryError);
      }
    }
  }

  private send<T>(
    endpoint: string,
    credential: FigmaCredential,
  ): Promise<{ data: T; rawSize: number }> {
    Logger.log(`Calling ${this.baseUrl}${endpoint} (${credential.kind} from ${credential.source})`);
    return fetchJSON<T & { status?: number }>(`${this.baseUrl}${endpoint}`, {
      headers: this.authHeaders(credential),
      redactFromResponseBody: [credential.token],
    });
  }

  private describeFailure(endpoint: string, error: unknown): Error {
    const meta = getErrorMeta(error);
    if (meta.http_status === 429) {
      return new Error(buildRateLimitMessage(error), { cause: error });
    }
    if (meta.http_status === 403) {
      return new Error(buildForbiddenMessage(endpoint, error), { cause: error });
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new Error(
      `Failed to make request to Figma API endpoint '${endpoint}': ${errorMessage}`,
      { cause: error },
    );
  }

  /**
   * Builds URL query parameters for SVG image requests.
   */
  private buildSvgQueryParams(svgIds: string[], svgOptions: SvgOptions): string {
    const params = new URLSearchParams({
      ids: svgIds.join(","),
      format: "svg",
      svg_outline_text: String(svgOptions.outlineText),
      svg_include_id: String(svgOptions.includeId),
      svg_simplify_stroke: String(svgOptions.simplifyStroke),
    });
    return params.toString();
  }

  /**
   * Gets download URLs for image fills without downloading them.
   *
   * @returns Map of imageRef to download URL
   */
  async getImageFillUrls(fileKey: string): Promise<Record<string, string>> {
    const endpoint = `/files/${fileKey}/images`;
    const response = await this.request<GetImageFillsResponse>(endpoint);
    return response.meta.images || {};
  }

  /**
   * Gets download URLs for rendered nodes without downloading them.
   *
   * @returns Map of node ID to download URL
   */
  async getNodeRenderUrls(
    fileKey: string,
    nodeIds: string[],
    format: "png" | "svg",
    options: { pngScale?: number; svgOptions?: SvgOptions } = {},
  ): Promise<Record<string, string>> {
    if (nodeIds.length === 0) return {};

    if (format === "png") {
      const scale = options.pngScale || 2;
      const endpoint = `/images/${fileKey}?ids=${nodeIds.join(",")}&format=png&scale=${scale}`;
      const response = await this.request<GetImagesResponse>(endpoint);
      return this.filterValidImages(response.images);
    } else {
      const svgOptions = options.svgOptions || {
        outlineText: true,
        includeId: false,
        simplifyStroke: true,
      };
      const params = this.buildSvgQueryParams(nodeIds, svgOptions);
      const endpoint = `/images/${fileKey}?${params}`;
      const response = await this.request<GetImagesResponse>(endpoint);
      return this.filterValidImages(response.images);
    }
  }

  /**
   * Download images method with post-processing support for cropping and returning image dimensions.
   *
   * Supports:
   * - Image fills vs rendered nodes (based on imageRef vs nodeId)
   * - PNG vs SVG format (based on filename extension)
   * - Image cropping based on transform matrices
   * - CSS variable generation for image dimensions
   *
   * @returns Array of local file paths for successfully downloaded images
   */
  async downloadImages(
    fileKey: string,
    localPath: string,
    items: Array<{
      imageRef?: string;
      gifRef?: string;
      nodeId?: string;
      fileName: string;
      needsCropping?: boolean;
      cropTransform?: Transform;
      requiresImageDimensions?: boolean;
    }>,
    options: { pngScale?: number; svgOptions?: SvgOptions } = {},
  ): Promise<ImageProcessingResult[]> {
    if (items.length === 0) return [];

    const resolvedPath = localPath;
    const { pngScale = 2, svgOptions } = options;
    const downloadPromises: Promise<ImageProcessingResult[]>[] = [];

    // Separate items by type: image/gif fills vs rendered nodes
    const imageFills = items.filter(
      (item): item is typeof item & ({ imageRef: string } | { gifRef: string }) =>
        !!item.imageRef || !!item.gifRef,
    );
    const renderNodes = items.filter(
      (item): item is typeof item & { nodeId: string } => !!item.nodeId,
    );

    // Download image fills (static images and animated GIFs) with processing
    if (imageFills.length > 0) {
      const fillUrls = await this.getImageFillUrls(fileKey);
      const fillDownloads = imageFills
        .map(
          ({
            imageRef,
            gifRef,
            fileName,
            needsCropping,
            cropTransform,
            requiresImageDimensions,
          }) => {
            // gifRef takes priority when present — it points to the animated GIF file.
            // imageRef only points to a static snapshot frame for GIF nodes.
            const fillRef = gifRef ?? imageRef;
            const imageUrl = fillRef ? fillUrls[fillRef] : undefined;
            return imageUrl
              ? downloadAndProcessImage(
                  fileName,
                  resolvedPath,
                  imageUrl,
                  needsCropping,
                  cropTransform,
                  requiresImageDimensions,
                )
              : null;
          },
        )
        .filter((promise): promise is Promise<ImageProcessingResult> => promise !== null);

      if (fillDownloads.length > 0) {
        downloadPromises.push(Promise.all(fillDownloads));
      }
    }

    // Download rendered nodes with processing
    if (renderNodes.length > 0) {
      const pngNodes = renderNodes.filter((node) => !node.fileName.toLowerCase().endsWith(".svg"));
      const svgNodes = renderNodes.filter((node) => node.fileName.toLowerCase().endsWith(".svg"));

      // Download PNG renders
      if (pngNodes.length > 0) {
        const pngUrls = await this.getNodeRenderUrls(
          fileKey,
          pngNodes.map((n) => n.nodeId),
          "png",
          { pngScale },
        );
        const pngDownloads = pngNodes
          .map(({ nodeId, fileName, needsCropping, cropTransform, requiresImageDimensions }) => {
            const imageUrl = pngUrls[nodeId];
            return imageUrl
              ? downloadAndProcessImage(
                  fileName,
                  resolvedPath,
                  imageUrl,
                  needsCropping,
                  cropTransform,
                  requiresImageDimensions,
                )
              : null;
          })
          .filter((promise): promise is Promise<ImageProcessingResult> => promise !== null);

        if (pngDownloads.length > 0) {
          downloadPromises.push(Promise.all(pngDownloads));
        }
      }

      // Download SVG renders
      if (svgNodes.length > 0) {
        const svgUrls = await this.getNodeRenderUrls(
          fileKey,
          svgNodes.map((n) => n.nodeId),
          "svg",
          { svgOptions },
        );
        const svgDownloads = svgNodes
          .map(({ nodeId, fileName, needsCropping, cropTransform, requiresImageDimensions }) => {
            const imageUrl = svgUrls[nodeId];
            return imageUrl
              ? downloadAndProcessImage(
                  fileName,
                  resolvedPath,
                  imageUrl,
                  needsCropping,
                  cropTransform,
                  requiresImageDimensions,
                )
              : null;
          })
          .filter((promise): promise is Promise<ImageProcessingResult> => promise !== null);

        if (svgDownloads.length > 0) {
          downloadPromises.push(Promise.all(svgDownloads));
        }
      }
    }

    const results = await Promise.all(downloadPromises);
    return results.flat();
  }

  /**
   * Get raw Figma API response for a file (for use with flexible extractors).
   *
   * Returns the parsed body alongside the raw body size in bytes so callers
   * can report payload size in metrics.
   */
  async getRawFile(
    fileKey: string,
    depth?: number | null,
  ): Promise<{ data: GetFileResponse; rawSize: number }> {
    const endpoint = `/files/${fileKey}?geometry=paths${depth ? `&depth=${depth}` : ""}`;
    Logger.log(`Retrieving raw Figma file: ${fileKey} (depth: ${depth ?? "default"})`);

    const result = await this.requestWithSize<GetFileResponse>(endpoint);
    writeLogs("figma-raw.json", result.data);

    return result;
  }

  /**
   * Get raw Figma API response for specific nodes (for use with flexible extractors).
   *
   * Returns the parsed body alongside the raw body size in bytes so callers
   * can report payload size in metrics.
   */
  async getRawNode(
    fileKey: string,
    nodeId: string,
    depth?: number | null,
  ): Promise<{ data: GetFileNodesResponse; rawSize: number }> {
    const endpoint = `/files/${fileKey}/nodes?ids=${nodeId}&geometry=paths${depth ? `&depth=${depth}` : ""}`;
    Logger.log(
      `Retrieving raw Figma node: ${nodeId} from ${fileKey} (depth: ${depth ?? "default"})`,
    );

    const result = await this.requestWithSize<GetFileNodesResponse>(endpoint);
    writeLogs("figma-raw.json", result.data);

    return result;
  }
}
