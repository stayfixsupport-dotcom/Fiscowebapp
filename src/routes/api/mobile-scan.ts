import { createFileRoute } from "@tanstack/react-router";

import { scanAndSaveMobileDocument } from "@/lib/mobile-scan.server";

export const Route = createFileRoute("/api/mobile-scan")({
  server: {
    handlers: {
      POST: ({ request }) => scanAndSaveMobileDocument(request),
    },
  },
});
