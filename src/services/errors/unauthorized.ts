import type { FigmaCredential } from "~/services/figma.js";
import { HttpError } from "~/utils/fetch-json.js";

const CREDENTIAL_LABEL: Record<FigmaCredential["kind"], string> = {
  oauth: "OAuth access token",
  pat: "personal access token",
};

/**
 * Build a user-facing 401 message. Figma answers 401 for an invalid or revoked
 * token (403 is permissions/scopes, handled separately). The caller has
 * already re-resolved the credential and either found it unchanged or retried
 * once with the new one, so by the time this renders there is nothing more
 * the server can do by itself — the message tells the agent what can.
 */
export function buildUnauthorizedMessage(
  endpoint: string,
  credential: FigmaCredential,
  error: unknown,
  { retried = false }: { retried?: boolean } = {},
): string {
  const body = error instanceof HttpError ? error.responseBody : undefined;
  const sections: string[][] = [
    [
      `Request to Figma API endpoint '${endpoint}' returned 401 Unauthorized: Figma rejected the ${CREDENTIAL_LABEL[credential.kind]} read from ${credential.source}.`,
      ...(body ? [`Response body: ${body}`] : []),
    ],
    [
      "The token was rotated or revoked. Figma keeps only ONE live access token per app per user, so refreshing a token anywhere (including a scheduled refresh by the platform that issued it) invalidates every copy still in use.",
      ...(retried
        ? ["The token was re-read after the first 401 and the new value was rejected as well."]
        : []),
    ],
    [
      "What to do: if this server runs inside a Blocks sandbox, call the `get_new_figma_token` tool to fetch the current token, or wait up to a minute for the refreshed token to land, then retry. Otherwise issue a new token in Figma and restart the server with it.",
    ],
  ];
  return sections.map((section) => section.join("\n")).join("\n\n");
}
