import { createFileRoute, redirect } from "@tanstack/react-router";

import { FiscoAiExperience } from "@/components/FiscoAiExperience";

export const Route = createFileRoute("/chat/fisco-ai")({
  beforeLoad: () => {
    throw redirect({ to: "/fisco-ai" });
  },
  head: () => ({
    meta: [
      { title: "Fisco AI — Tax & Accounting Assistant" },
      {
        name: "description",
        content:
          "Ask Fisco AI about taxes, payroll, VAT, bookkeeping, and accounting workflows in Poland and the EU.",
      },
      { property: "og:title", content: "Fisco AI" },
      {
        property: "og:description",
        content: "Tax and accounting guidance for taxpayers and accountants inside the Fisco app.",
      },
    ],
  }),
  component: FiscoAiRoute,
});

function FiscoAiRoute() {
  return <FiscoAiExperience showIntro />;
}
