import { createOpenAI } from "@ai-sdk/openai";
import { smoothStream, streamText, type ModelMessage } from "ai";

import {
  createLovableAiGatewayRunIdFetch,
  getLovableAiGatewayRunId,
  withLovableAiGatewayRunIdHeader,
} from "./run-id.server";

export function createResponsesCall(
  request: Request,
  config: { baseURL: string; apiKey: string; model: string },
  messages: ModelMessage[],
  instructions?: string,
) {
  const runIdFetch = createLovableAiGatewayRunIdFetch(getLovableAiGatewayRunId(request));
  const provider = createOpenAI({
    baseURL: `${config.baseURL.replace(/\/+$/, "").replace(/\/v1$/, "")}/v1`,
    apiKey: config.apiKey,
    headers: { "Lovable-API-Key": config.apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    fetch: runIdFetch.fetch,
  });
  const result = streamText({
    model: provider.responses(config.model),
    ...(instructions ? { instructions } : {}),
    messages,
    experimental_transform: smoothStream({ delayInMs: 32, chunking: "word" }),
    abortSignal: request.signal,
    providerOptions: {
      openai: {
        store: false,
      },
    },
  });
  return {
    result,
    response: (originalMessages?: unknown) =>
      withLovableAiGatewayRunIdHeader(
        result.toUIMessageStreamResponse({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          originalMessages: originalMessages as any,
          sendReasoning: false,
          onError: (error: unknown) => {
            console.error("[fisco/stream]", error);
            return error instanceof Error ? error.message : "Fisco lost the connection.";
          },
        }),
        runIdFetch,
      ),
  };
}
