# Rudra Health OS — Fresh Start in VS Code

**Starting condition:** brand new application, **no old repository or code**. This pack contains only product requirements, implementation guardrails, architecture and AI coding prompts.

## 1. Install prerequisites (Windows)
- VS Code and Git.
- **Node.js 24 LTS** with npm (use the official LTS installer).
- Later: PostgreSQL (local installation or Docker Desktop). A database is **not necessary to display the first UI shell**.

In VS Code terminal (PowerShell):

```powershell
node --version
npm --version
git --version
```

## 2. Create the brand-new Next.js application
Navigate in PowerShell to your chosen projects parent directory, then:

```powershell
npx create-next-app@latest rudra-health-os --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm
cd rudra-health-os
code .
npm run dev
```

Open `http://localhost:3000` and verify the new application loads. Stop with Ctrl+C before letting the coding agent make major edits.

The `create-next-app` command creates the fresh codebase; **this documentation pack is not a runnable replacement for it**.

## 3. Copy this pack into the new project root
After creating the Next app, copy the provided `AGENTS.md`, `PROMPT_01_FOR_VS_CODE_AGENT.md`, and `docs/` folder into `rudra-health-os/`. Keep `START_HERE.md` there as well. Do **not** overwrite your generated `package.json` or any Next.js configuration files.

## 4. In VS Code, instruct your coding assistant
Open `PROMPT_01_FOR_VS_CODE_AGENT.md`. Ask it to implement **Phase 00 only**. Tell it to read `AGENTS.md` and `docs/DECISIONS.md` first.

Do not ask the coding agent to invent Metropolis APIs, actual patient data or payment integrations.

## 5. Recommended starting stack
| Layer | Choice | Reason |
|---|---|---|
| Full-stack web app | Next.js App Router / TypeScript | One site, role-specific portals, server-side features |
| Design | Tailwind CSS + accessible reusable components | Consistent UI across desktop/mobile |
| Persistence | PostgreSQL | Relational data, constraints, transactions and auditing |
| ORM/migrations | Prisma **stable supported release** or Drizzle after initial evaluation | Explicit typed schema and migrations |
| Validation | Zod or equivalent | Server validation on all writes |
| Authentication | Mature OIDC/identity provider with MFA for staff; separate secure patient identity flow | Identity assurance and staff controls |
| Background tasks | A worker/queue added when needed | Notifications, reminders, imports, status processing |
| Documents | Private object storage with server-authorized access | Reports and attachments must stay private |
| Tests | Unit/integration tests + Playwright end-to-end | Prevent broken journeys and role leaks |

Do not decide payments gateway, WhatsApp vendor, voice provider, cloud hosting or Metropolis connectivity until the corresponding phase requires an approved choice. Use typed adapters rather than hard-coding a vendor throughout the product.

## 6. Recommended repository layout

```text
rudra-health-os/
  AGENTS.md
  START_HERE.md
  PROMPT_01_FOR_VS_CODE_AGENT.md
  docs/
    ARCHITECTURE.md
    DECISIONS.md
    PHASES_AND_ACCEPTANCE.md
    SCREEN_SPEC_178.md
  prisma/                     # add when persistence begins
  public/                     # Rudra-owned approved assets only
  src/
    app/
      (public)/               # /, /tests, /packages, /book, /contact
      (patient)/account/      # verified patient and family portal
      (staff)/staff/          # authenticated reception/field/branch screens
      (management)/owner/     # owner/manager operations
      api/v1/                 # HTTP endpoints/route handlers as needed
    components/
      ui/
      layout/
      shared/
    modules/
      identity/
      patients/
      families/
      leads/
      catalogue/
      appointments/
      orders/
      collections/
      specimens/
      timelines/
      billing/
      payments/
      metropolis/
      communications/
      marketing/
      operations/
      audit/
    server/
      auth/
      db/
      permissions/
      services/
    lib/
    styles/
  tests/
```

This is a **target structure**. Only create folders/files when their implementation starts. Do not create dozens of empty folders for appearances.

## 7. Mandatory project checkpoints
1. **Phase 00:** New Next app + responsive brand/site shell + route skeleton, accessible UI, no fake connected data.
2. **Phase 01:** Database, identity, owner bootstrap, role/centre authorization, audit/event framework.
3. **Phase 02:** Patient & Family 360°, leads, contact consent, duplicate detection.
4. **Phase 03:** Verified catalogue, Metropolis reference mapping, packages/promotions, booking/order core.
5. **Phase 04:** Assignments, field staff, sample tracking, custody timeline, manual Metropolis fallback.
6. **Phase 05:** Billing/fees, payment records, invoice issuer distinction, refunds/reconciliation.
7. **Phase 06:** Secure patient portal, reports, communications and operations dashboard.
8. **Phase 07+:** AI, WhatsApp, calling, social and marketing, quality, inventory, partners and multi-centre expansion, with approvals.

See detailed gates in `docs/PHASES_AND_ACCEPTANCE.md`.

## 8. Golden business rule
The first real end-to-end journey must be: **patient registers → test selected → booking confirmed → staff assigned → out for collection → sample collected → branch received → sample dispatched → Metropolis receipt verified manually or by authorized feed → report safely delivered → payment reconciled**. Steps can be parallel or exceptional; never force a false completion.

## 9. Development cautions
- Use **synthetic records only** until an authorized staging and security review.
- Maintain `.env.example` with names, but `.env.local` and all credentials must stay out of version control.
- Never display an adult family member's reports to another member without authorization.
- Design owner approvals and manual "Mark Done" events as server-validated audited actions.
- The current supplied Metropolis package prices are approved by the user, but include effective date, package variants and promotion conditions in the product model.
