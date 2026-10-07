This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.


## Search Providers
MARCOM uses a provider-neutral search architecture.
You can switch search providers via the `.env.local` file:

```env
SEARCH_PROVIDER=exa
EXA_API_KEY=your-exa-key
SEARCH_MAX_RESULTS=25
SEARCH_TIMEOUT_MS=15000
```

### Available Providers
- `exa`: Uses the Exa Neural Search API (requires EXA_API_KEY). Highly recommended for production.
- `groq-browser`: Uses the legacy Groq built-in browser search.
- `fake`: Uses deterministic fake results for testing.

### Developer Scripts
- **Smoke Test:** `npm run search:smoke` (Tests the configured search provider without hitting the database)
- **Tests:** `npm run test`
