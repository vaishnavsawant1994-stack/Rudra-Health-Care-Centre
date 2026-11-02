# Rudra Health OS — Product Decisions and Unknowns

## Locked business direction
- **New VS Code project from scratch. No code or migration reuse from any old repository.**
- Rudra Health Care Centre is the primary customer-facing business brand; Metropolis Healthcare is its franchise diagnostic/lab partner.
- **Single product:** responsive public website + customer and family portal + CRM + staff/branch/owner/marketing/AI interfaces backed by shared Rudra APIs and data models.
- Test and package customer prices follow currently approved Metropolis prices. Maintain price/promotion version, effective dates and variant eligibility.
- Home sample collection fee is a **separate Rudra service line**; authorized staff choose **₹0, ₹75, ₹99, ₹150, or custom**, with reason/audit rules; no invented distance automation.
- Both Rudra-issued and Metropolis-issued billing arrangements must be supported. Final invoice issuer/tax/settlement responsibilities will be specified later. Prevent duplication.
- Metropolis integration is **manual-first**; APIs/webhooks/exports might be unavailable. Manual entry, review, approved imports and verification are fundamental, not afterthoughts.
- Staff record actual actions via permissioned controls. System must retain original and corrected event history; invalid transitions rejected.
- Patient 360° and Family 360° with individual permanent Rudra patient identities and explicit adult relative report-access authorization.
- Customer sees the relevant care journey; staff see job-specific tasks and daily assignments; managers/owner see operational queues with centre scopes.
- Owners control social media and marketing, can delegate granular permissions, budget and publishing approvals.
- AI website chatbot, WhatsApp and inbound/outbound phone will use one approved knowledge source and same CRM, but no diagnosis, unconsented campaigns, fabricated prices or autonomous approval of financial/medical actions.

## Decisions still open (design for both, not assumptions)
- Exact Metropolis integration permission, API/feed availability and data-use terms.
- Legal invoicing and settlement details, taxes and refunds.
- Metropolis document/report exchange permissions; report authorship and critical-result escalation protocol.
- Privacy notice, retention schedule, patient consent and legal compliance review.
- Collection QA, rejection/recollection, sample dispatch and urgent clinical escalation SOPs.
- Deployment provider, identity vendor, messaging/voice/ads vendor, payment gateway, centre details and approved franchise branding wording.

## Operational statuses must be real
A button can log **staff verified an event**; it cannot certify a Metropolis lab test was processed or medically authorized without external evidence. Distinguish planned, recorded, externally verified, overdue, exception and corrected states. Payment and collection are not necessarily sequential.

## Patient portal access gate

Patient portal account creation and sign-in remain disabled until the Owner approves an identity-proofing process/provider. Phone number, Rudra patient number, or family relationship alone must not enable an account or establish authority. This is a gating decision, not approval of a particular verification method.
