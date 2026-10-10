import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronDown, HelpCircle, Mail, MessageCircle, Sparkles } from "lucide-react";
import { BlurFade } from "@/components/motion/BlurFade";
import { Btn, Card } from "@/components/kit";
import { FAQS } from "@/lib/faq";
import { sfx } from "@/lib/sfx";
import { useT } from "@/lib/ui-prefs";

export const Route = createFileRoute("/faq")({
  head: () => ({
    meta: [
      { title: "FAQ — Fisco · Frequently Asked Questions" },
      {
        name: "description",
        content:
          "Everything you need to know about Fisco: scanning invoices with AI, finding a local accountant, VAT & tax questions, privacy, and pricing. Get answers instantly.",
      },
      { property: "og:title", content: "FAQ — Fisco · Frequently Asked Questions" },
      {
        property: "og:description",
        content:
          "Answers to the most common questions about Fisco — AI document scanning, finding accountants near you, tax help, and more.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "index, follow" },
    ],
  }),
  component: FaqPage,
});

const EASE = [0.16, 1, 0.3, 1] as const;

function FaqItem({ q, a, index }: { q: string; a: string; index: number }) {
  const [open, setOpen] = useState(false);
  const t = useT();

  return (
    <BlurFade delay={index * 0.04}>
      <button
        id={`faq-item-${index}`}
        onClick={() => {
          sfx(open ? "swipe" : "reveal");
          setOpen(!open);
        }}
        aria-expanded={open}
        className="press w-full text-left"
      >
        <Card className="overflow-hidden">
          <div className="flex items-start gap-3 p-4">
            <span
              className={`grid size-8 shrink-0 place-items-center rounded-xl transition-colors duration-200 ${
                open ? "bg-primary text-primary-foreground" : "bg-secondary/60"
              }`}
            >
              <motion.span
                animate={{ rotate: open ? 180 : 0 }}
                transition={{ type: "spring", stiffness: 300, damping: 26 }}
                style={{ display: "flex" }}
              >
                <ChevronDown className="size-4" />
              </motion.span>
            </span>
            <span className="flex-1 pt-0.5 text-[14px] font-bold leading-snug tracking-[-0.01em]">
              {t(q)}
            </span>
          </div>
          <AnimatePresence initial={false}>
            {open && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.28, ease: EASE }}
                className="overflow-hidden"
              >
                <p className="px-4 pb-4 pl-[3.25rem] text-[13.5px] leading-relaxed text-muted-foreground">
                  {t(a)}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </Card>
      </button>
    </BlurFade>
  );
}

function FaqPage() {
  const t = useT();
  return (
    <div className="mx-auto w-full max-w-[720px] px-4 pt-5 pb-32">
      {/* Header */}
      <BlurFade>
        <div className="mb-8">
          <div className="mb-3 flex items-center gap-2">
            <span className="grid size-9 place-items-center rounded-2xl bg-ink text-ink-foreground">
              <HelpCircle className="size-[17px]" strokeWidth={2} />
            </span>
            <span className="text-[10px] font-bold tracking-[0.18em] uppercase text-muted-foreground">
              {t("Help Centre")}
            </span>
          </div>
          <h1 className="text-[28px] font-extrabold leading-tight tracking-[-0.03em]">
            {t("Frequently asked")}
            <br />
            <span className="text-primary">{t("questions")}</span>
          </h1>
          <p className="mt-2 text-[14px] text-muted-foreground">
            {t("Everything you need to know about Fisco, document scanning, finding accountants, and tax help.")}
          </p>
        </div>
      </BlurFade>

      {/* FAQ sections */}
      {FAQS.map((section, si) => (
        <div key={section.category} className="mb-8">
          <BlurFade delay={si * 0.06}>
            <div className="mb-3 flex items-center gap-2">
              <span className="h-px flex-1 bg-border" />
              <span className="text-[10px] font-bold tracking-[0.14em] uppercase text-muted-foreground">
                {t(section.category)}
              </span>
              <span className="h-px flex-1 bg-border" />
            </div>
          </BlurFade>
          <div className="flex flex-col gap-2">
            {section.items.map((item, ii) => (
              <FaqItem key={item.q} q={item.q} a={item.a} index={si * 10 + ii} />
            ))}
          </div>
        </div>
      ))}

      {/* CTA */}
      <BlurFade delay={0.4}>
        <Card className="mt-4 p-6 text-center">
          <span className="mx-auto mb-3 grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
            <Sparkles className="size-5" />
          </span>
          <h2 className="text-[16px] font-extrabold tracking-tight">{t("Still have questions?")}</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {t("Ask FISCO AI — our built-in accounting assistant answers tax, VAT, and invoice questions instantly.")}
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Link to="/chat" onClick={() => sfx("open")}>
              <Btn id="faq-cta-chat" variant="accent" className="gap-2 w-full sm:w-auto">
                <MessageCircle className="size-4" />
                {t("Chat with FISCO AI")}
              </Btn>
            </Link>
            <a href="mailto:support@fisco.app" onClick={() => sfx("tap")}>
              <Btn id="faq-cta-email" variant="ghost" className="gap-2 w-full sm:w-auto">
                <Mail className="size-4" />
                {t("Email support")}
              </Btn>
            </a>
          </div>
        </Card>
      </BlurFade>
    </div>
  );
}
