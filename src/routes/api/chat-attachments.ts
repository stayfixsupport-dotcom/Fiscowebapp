import { createFileRoute } from "@tanstack/react-router";

import { sendChatAttachment } from "@/lib/chat-attachments.server";

export const Route = createFileRoute("/api/chat-attachments")({
  server: {
    handlers: {
      POST: ({ request }) => sendChatAttachment(request),
    },
  },
});
