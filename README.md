# Rudra Health OS

A fresh Next.js application for Rudra Health Care Centre. This repository starts from the supplied product requirements and does not reuse an older Rudra implementation.

## Run locally

Requirements: Node.js 24 LTS and npm.

```powershell
npm.cmd install
npm.cmd run dev
```

Open <http://localhost:3000>. Use `Ctrl+C` to stop the development server.

Run the Phase 00 checks with:

```powershell
npm.cmd run lint
npm.cmd run build
```

## Phase 00 routes

- `/` — Rudra homepage (W001)
- `/tests` — test catalogue shell (W003)
- `/packages` — package catalogue shell (W005)
- `/book` — booking entry shell (W007)
- `/account` — patient access placeholder (P001)
- `/staff` — staff access placeholder

Catalogue data, prices, booking, patient identity and staff authentication are not connected yet. The pages explain these limits and contain no patient records, prices or false confirmation actions.

## Project documents

Read `AGENTS.md`, `START_HERE.md`, `PROMPT_01_FOR_VS_CODE_AGENT.md` and `docs/` for product decisions, architecture and acceptance gates. Build only one verified phase at a time.
