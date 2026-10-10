/** Taxpayer clients of the practice — what an accountant sees in "Clients". */
export type Taxpayer = {
  id: string;
  name: string;
  initials: string;
  photo: string;
  kind: "Freelancer" | "Micro-enterprise" | "SARL" | "Retail" | "E-commerce";
  city: string;
  plan: "Monthly" | "Quarterly" | "Annual";
  docs: number;
  open: number;
  progress: number;
  billed: number;
  lastActive: string;
  vatDue: string;
};

export const TAXPAYERS: Taxpayer[] = [
  {
    id: "t1",
    name: "Malik Boulakhras",
    initials: "MB",
    photo:
      "https://images.unsplash.com/photo-1633332755192-727a05c4013d?w=200&q=80&auto=format&fit=crop&crop=faces",
    kind: "Freelancer",
    city: "Alger Centre",
    plan: "Monthly",
    docs: 18,
    open: 3,
    progress: 72,
    billed: 1240,
    lastActive: "2 h ago",
    vatDue: "20 Mar",
  },
  {
    id: "t2",
    name: "Sarah Amrani",
    initials: "SA",
    photo:
      "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&q=80&auto=format&fit=crop&crop=faces",
    kind: "E-commerce",
    city: "Hydra",
    plan: "Monthly",
    docs: 44,
    open: 0,
    progress: 96,
    billed: 2380,
    lastActive: "20 min ago",
    vatDue: "20 Mar",
  },
  {
    id: "t3",
    name: "Yacine Ould Ali",
    initials: "YO",
    photo:
      "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&q=80&auto=format&fit=crop&crop=faces",
    kind: "SARL",
    city: "Bab Ezzouar",
    plan: "Quarterly",
    docs: 61,
    open: 6,
    progress: 41,
    billed: 3940,
    lastActive: "Yesterday",
    vatDue: "25 Mar",
  },
  {
    id: "t4",
    name: "Nour El Houda",
    initials: "NH",
    photo:
      "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=200&q=80&auto=format&fit=crop&crop=faces",
    kind: "Micro-enterprise",
    city: "Kouba",
    plan: "Annual",
    docs: 12,
    open: 1,
    progress: 63,
    billed: 640,
    lastActive: "3 d ago",
    vatDue: "05 Apr",
  },
  {
    id: "t5",
    name: "Riad Benhamou",
    initials: "RB",
    photo:
      "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&q=80&auto=format&fit=crop&crop=faces",
    kind: "Retail",
    city: "Hussein Dey",
    plan: "Monthly",
    docs: 87,
    open: 4,
    progress: 58,
    billed: 2760,
    lastActive: "5 h ago",
    vatDue: "20 Mar",
  },
  {
    id: "t6",
    name: "Imene Ferhat",
    initials: "IF",
    photo:
      "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&q=80&auto=format&fit=crop&crop=faces",
    kind: "Freelancer",
    city: "El Biar",
    plan: "Quarterly",
    docs: 24,
    open: 0,
    progress: 88,
    billed: 980,
    lastActive: "1 h ago",
    vatDue: "05 Apr",
  },
  {
    id: "t7",
    name: "Tarek Belhadj",
    initials: "TB",
    photo:
      "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=200&q=80&auto=format&fit=crop&crop=faces",
    kind: "SARL",
    city: "Chéraga",
    plan: "Monthly",
    docs: 53,
    open: 2,
    progress: 77,
    billed: 3110,
    lastActive: "Yesterday",
    vatDue: "20 Mar",
  },
  {
    id: "t8",
    name: "Lyna Cherifi",
    initials: "LC",
    photo:
      "https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?w=200&q=80&auto=format&fit=crop&crop=faces",
    kind: "E-commerce",
    city: "Birkhadem",
    plan: "Annual",
    docs: 31,
    open: 5,
    progress: 34,
    billed: 1520,
    lastActive: "4 d ago",
    vatDue: "25 Mar",
  },
];
