import { createFileRoute } from "@tanstack/react-router";

import { deleteChatMessage } from "@/lib/chat-attachments.server";

export const Route = createFileRoute("/api/chat-messages/$messageId")({
  server: {
    handlers: {
      DELETE: ({ request, params }) => deleteChatMessage(request, params.messageId),
    },
  },
});
