# MARCOM automation prototype

This Next.js prototype analyses campaign briefs, stores structured campaign data, discovers prospects, and builds evidence-backed research records for human review.

The brief analyser remains separate from prospect search:

1. Groq analyses the uploaded campaign brief.
2. The selected search provider finds public web results.
3. Groq extracts candidate identities and research facts only from those supplied results.
4. Deterministic validation checks sources, evidence, duplicates, and unknown values before a record is saved.

## Local setup

Install dependencies:

```powershell
npm install
```

Copy the environment template:

```powershell
Copy-Item -LiteralPath '.env.example' -Destination '.env.local'
```

Add the existing Groq key and an Exa key to `.env.local`:

```text
GROQ_API_KEY=your_groq_key
SEARCH_PROVIDER=exa
EXA_API_KEY=your_exa_key
SEARCH_MAX_RESULTS=25
SEARCH_TIMEOUT_MS=15000
```

Do not commit `.env.local`.

Run a small Exa search before starting the interface:

```powershell
npm run search:smoke
```

The command prints the provider, request ID, cost reported by the provider, and up to three normalized results. It does not print credentials.

Start the application:

```powershell
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Switching search providers

Set `SEARCH_PROVIDER` in `.env.local`, then restart the development server.

| Value | Purpose |
| --- | --- |
| `exa` | Live Exa web search. Requires `EXA_API_KEY`. |
| `fake` | Deterministic local results for UI and integration development. Uses no network or credits. |
| `groq-browser` | Compatibility adapter for the previous Groq browser-search implementation. |

The application routes and research agent depend on the shared `SearchProvider` contract. Vendor response types remain inside their adapters, so adding another provider does not require changes to campaign or research code.

## Verification

```powershell
npm test
npx tsc --noEmit
npm run build
```

`npm test` runs the provider contract tests without calling a live provider.
