# Fisco

Fisco helps taxpayers and accountants manage documents, appointments, and accounting tasks. The web app is built with React, TypeScript, and TanStack Start, with Supabase for authentication and application data.

## Features

- Document scanning, uploads, and organization
- Accountant discovery, profiles, appointments, and messaging
- Activity views and AI-assisted workflows
- Supabase-backed application data and Google Drive document storage

Some features require external services and credentials to be configured.

## Requirements

- Node.js and npm
- A Supabase project


Apply `supabase/schema.sql` to your Supabase project, then start the development server:

```sh
npm run dev
```

## Configuration

The browser uses Supabase publishable credentials. Server-side features may need additional Supabase credentials and provider settings configured in the deployment environment. AI and Google Drive features require their respective integrations.

Do not commit `.env` files or put service-role keys in `VITE_` variables. Values prefixed with `VITE_` are exposed to browser code.

## Checks

```sh
npm run lint
npm run build
```

## Project structure

| Path | Purpose |
| --- | --- |
| `src/` | Web application, routes, and server handlers |
| `supabase/schema.sql` | Canonical Supabase schema |
| `supabase/functions/` | Supabase Edge Functions |
| `drizzle/` | Drizzle schema and migrations |

## Copyright

Copyright (c) 2026 Seif El Islam. All rights reserved.
