import { createFileRoute } from "@tanstack/react-router";
import { deleteDocument, serveDocumentFile } from "@/lib/documents.server";

export const Route = createFileRoute("/api/documents/$id")({
  server: {
    handlers: {
      GET: ({ request, params }) => serveDocumentFile(request, params.id),
      DELETE: ({ request, params }) => deleteDocument(request, params.id),
    },
  },
});
