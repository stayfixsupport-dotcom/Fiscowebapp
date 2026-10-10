export const FAQS: { category: string; items: { q: string; a: string }[] }[] = [
  {
    category: "Getting started",
    items: [
      {
        q: "What is Fisco?",
        a: "Fisco is a smart accounting companion app. You can scan receipts and invoices with AI, organise your documents, track your expenses, and connect directly with a verified accountant near you — all in one place.",
      },
      {
        q: "Is Fisco free to use?",
        a: "The core scanning, document storage, and map features are free. Premium features like advanced analytics and priority accountant matching may be introduced in future plans.",
      },
      {
        q: "Which countries is Fisco available in?",
        a: "Fisco is available worldwide. The app automatically detects your country and shows accountants in your area. Invoices can be in any language — French, Polish, Arabic, English, German, and more.",
      },
      {
        q: "Do I need an account to use Fisco?",
        a: "You can browse accountants on the map without signing in. To scan documents, save records, or message an accountant, you'll need a free account.",
      },
    ],
  },
  {
    category: "AI Document Scanning",
    items: [
      {
        q: "How does the AI scanning work?",
        a: "You can take a photo with your camera or upload a PDF. Fisco's AI (powered by Google Gemini) reads the document, extracts the merchant name, total amount, VAT, invoice number, and line items — no manual typing needed.",
      },
      {
        q: "What document types can I scan?",
        a: "Fisco supports invoices, receipts, payroll slips, tax forms, contracts, utility bills, transport receipts, and most standard fiscal documents as photos (JPEG/PNG) or PDF files.",
      },
      {
        q: "How accurate is the AI reading?",
        a: "Accuracy depends on document quality. For clear, printed documents the AI achieves 90-98% accuracy. Handwritten or low-quality scans may have lower confidence — always review extracted fields before saving.",
      },
      {
        q: "Is my document data private?",
        a: "Documents are processed via the Gemini API and stored in your private Supabase database, scoped to your account only. Nobody else — including accountants — can see your files unless you explicitly send them.",
      },
      {
        q: "Can I scan documents in Polish or French?",
        a: "Yes. Fisco AI is multilingual and handles documents in Polish, French, Arabic, English, German, and many other languages automatically.",
      },
    ],
  },
  {
    category: "Finding an Accountant",
    items: [
      {
        q: "How does the accountant map work?",
        a: "The map uses your real GPS location (or IP-based location as fallback) to show verified accountants in your country, sorted by distance. You can filter by availability, rating, or specialty.",
      },
      {
        q: "Are the accountants verified?",
        a: "Accountants who register on Fisco complete a practice profile with their firm name, location, specialties, and qualifications. The verified badge indicates a completed, reviewed profile.",
      },
      {
        q: "Why do I only see accountants from my country?",
        a: "By design, Fisco filters accountants by your detected country so you only see professionals licensed and based where you are. This ensures legal compliance and relevance.",
      },
      {
        q: "How do I book an appointment?",
        a: "Tap any accountant card on the map or in the list, then tap 'Book appointment'. You can choose a day and time slot, and the accountant will confirm via the messaging system.",
      },
      {
        q: "I'm an accountant — how do I list my practice?",
        a: "Sign up, select 'Accountant' as your role, then complete your Practice profile. Once saved, your profile appears on the map for clients in your country.",
      },
    ],
  },
  {
    category: "Tax & Accounting Questions",
    items: [
      {
        q: "Can Fisco help me with my VAT return?",
        a: "The built-in AI assistant (FISCO AI) can answer VAT/TVA questions, explain deductions, guide you through fiscal declarations (G50, IRG, IBS, VAT returns), and help categorise expenses. It does not file returns directly — consult your accountant for the official submission.",
      },
      {
        q: "What currencies and tax systems does Fisco support?",
        a: "Fisco supports PLN, EUR, USD, DZD, GBP, and most global currencies. The AI understands tax systems across Europe, North Africa, and beyond — including Polish NIP, French TVA, Algerian NIF/G50, and UK VAT.",
      },
      {
        q: "Can I export my documents or expense reports?",
        a: "You can send selected documents to your accountant via the Send screen. Export-to-PDF and accountant-ready report generation are on the roadmap.",
      },
    ],
  },
  {
    category: "Privacy & Security",
    items: [
      {
        q: "Where is my data stored?",
        a: "All user data is stored in a private Supabase (PostgreSQL) database protected by Row Level Security (RLS). Document files are stored in Google Drive, linked to your account only.",
      },
      {
        q: "Can Fisco see my financial data?",
        a: "No. Fisco is a self-hosted architecture where your data is scoped to your own account. We do not access or sell personal financial information.",
      },
      {
        q: "How do I delete my account?",
        a: "Go to Profile → Settings and use the Delete Account option. This permanently removes your account, documents, and data from our systems.",
      },
    ],
  },
];
