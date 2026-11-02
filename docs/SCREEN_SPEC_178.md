# Rudra Health OS — Master Screen-by-Screen Architecture & Workflow Specification

**Document ID:** RHC-ARCH-SCREENS-001  
**Version:** 1.0 proposed acceptance baseline  
**Date:** 24 October 2026  
**Status:** Architecture proposal; requires product-owner acceptance and implementation evidence  
**Business:** Rudra Health Care Centre — primary customer-facing brand  
**Laboratory franchise partner:** Metropolis Healthcare  
**Scope:** Unified Rudra public website, patient/family portal, staff CRM, collections, branch operations, reports, billing, communications/AI, marketing, owner controls and platform governance.

> **Scope is not implementation status.** This document defines desired behavior; it does not assert these screens are already built, connected to Metropolis or in production. Screen routes are proposed paths; routing can be adjusted during UI design while retaining stable screen IDs. Counts mean route-level screens, not individual reusable dialogs or buttons.

## A. Non-negotiable product decisions

1. The website, portal, CRM and management consoles are **one Rudra Health OS product** with shared domain APIs, consistent user identity and business records; no detached second CRM.
2. Customers primarily interact with Rudra. Display Metropolis identity, lab accreditation, report issuer and franchise terms wherever mandated by contract or law; do not pretend Rudra performed a lab test it did not.
3. One permanent Rudra Patient ID (`RHC-PAT-000001` style); each family member has their own identity and access permissions. Metropolis IDs are mapped external references.
4. One event/timeline engine holds verified milestones from public bookings, field collection, branch handovers, payments, reporting and support. Three views: patient-safe, job-specific staff, privileged operational/admin. **No fabricated status or timestamp.**
5. Manual-first, API-optional: allow authorized staff to enter external references, import approved CSV/Excel files, attach authorized documents and record verified manual statuses. Future approved APIs/webhooks must use the same business interface and workflow transitions.
6. Customer diagnostics prices equal the current approved Metropolis prices; approved TruHealth promotions are versioned. Home visit fees are separately selected manually: **₹0, ₹75, ₹99, ₹150, or authorized custom amount**; do not infer distance-based rates. Require confirmed quote before final booking.
7. Both Rudra-issued and Metropolis-issued billing arrangements are configurable pending confirmation of issuer, tax and settlement mechanics. Do not issue duplicate legal tax invoices.
8. Owner retains control over staff roles, centres, social identities, content publishing, ad budgets, data exports and critical approvals, with delegated time-bounded granular access.
9. AI website/WhatsApp/phone use approved catalog/knowledge and audited, permissioned business actions; handle handoff, opt-outs, privacy, non-diagnostic safety boundaries and approval before significant outbound actions.
10. Human-dependent steps have **permissioned Mark Done / Receive / Submit / Reject / Escalate** buttons, but completion must mean the staff member genuinely performed or verified the act. Lab result authorization is not an ordinary button.
11. User actions run in the backend with authenticated access control, request validation, idempotency for financial/integration actions, audited change history, transaction safety and event-driven notifications.
12. Build all listed modules incrementally behind feature flags using the same domain model. This full inventory is the target state, not a requirement to deploy every feature before initial launch.

## B. Experience boundaries and navigation

| Experience | Example entry route | Users | Primary menus | Shared objects |
|---|---|---|---|---|
| Public website | `/` | Visitors | Home, Tests, Packages, Home Collection, Centres, Contact, AI | Published catalogue, CMS, serviceability, lead |
| Patient/family portal | `/account` | Verified patients and authorized relatives | Overview, Bookings, Journey, Family, Reports, Payments, Support | Patient, family, order, report and consent |
| Reception/CRM | `/staff`, `/crm` | Reception, support, staff | Patients, Leads, Appointments, Orders, Billing, Queue, Enquiries | CRM, schedule, billing and work items |
| Field staff | `/field` | Assigned phlebotomists | Today, Jobs, Route, Checklists, Handover, Exceptions | Task, collection, sample and custody |
| Branch/logistics | `/branch`, `/integrations/metropolis` | Authorized branch/lab liaison | Receive, Quality, Dispatch, Lab Status, Reports | Sample, transport and external events |
| Finance | `/finance` | Reception, accounts, owner (scoped) | Quotes, Bills, Payments, Closing, Settlement | Ledger, payment, issuer and adjustment |
| Partnerships | `/relationships`, `/corporates`, `/partners` | Sales, doctor relations, corporate, partner | Doctors, Corporate, B2B, Contracts | Partnership, contract, partner order |
| Communications & AI | `/communications`, `/ai`, `/support` | Support, AI supervisor, owner | Inbox, Calls, Bot, Knowledge, Tickets | Conversation, opt-in, customer case |
| Marketing | `/marketing` | Owner, marketing delegates | Studio, Calendar, Accounts, Approvals, Ads, Analytics | Content, ad spend, campaign, lead |
| Management/owner | `/manage`, `/owner`, `/quality`, `/analytics` | Managers, owner | Action Centre, Staff, Inventory, Quality, Analytics | Tasks, incidents, aggregate metrics |
| Platform administration | `/admin` | Authorized owner/IT/compliance | Users, Permissions, Privacy, Integrations, Releases | Roles, audit, infrastructure and policy |

**Mobile navigation:** customers: Home / Book / Journey / Reports / Account. Field staff: Today / Route / Scan / Handover / Help. Desktop staff: left sidebar + universal order/patient search; manager/owner: overview + action queue. Each screen must have breadcrumbs, responsive layout, accessible keyboard/touch actions, empty/loading/denied/error/offline states, and safe back-navigation.

### Permission and privacy rules

- **Patient**: see only their own records and specifically authorized family-linked records. A family link alone **does not** allow access to an adult family member's medical results.
- **Receptionist**: book, check in, contact and bill within allocated centre scope; access only health information needed for job.
- **Phlebotomist**: only assigned collection information and relevant preparation instructions, not entire financial or family history.
- **Branch/logistics**: identify specimens and logistics events; clinical results only if explicitly authorized.
- **Accounts**: invoice, payment and settlement without unrestricted medical records.
- **Support**: identity-verification-gated status information; no report content until authorized.
- **Marketing**: campaign and consent-safe leads/analytics, no patient reports, diagnoses or health-based advertising exports.
- **Doctor/partner/corporate**: segregated permissions and per-patient authorization; employer must not receive individual medical records by default.
- **Owner/admin**: broad business control does not mean every employee (or the owner acting in a nonclinical role) should freely access all clinical details. Sensitive-record access is logged and restricted to a legitimate purpose.
- **AI agents**: act as restricted service identities with per-tool scopes, explicit human gates for exception payments, marketing spend, medical escalation and bulk outbound communications.

## C. Screen inventory — authoritative IDs, actions, backends

Every `→ID` means a navigational transition to the referenced screen. Unqualified verbs (e.g. 'Save', 'Confirm', 'Assign') are backend writes requiring role/centre checks and audit records; views are live queries with pagination/filtering as appropriate.

**Inventory totals:** **178 proposed route-level screens across 11 experience groups.** This inventory expands the earlier approximate 110 staff/admin + 26 public-page baseline with additional portal, manual operational, communications and marketing experiences. Some screens may be implemented as tabs within a shared route to reduce UI complexity without deleting their acceptance IDs.

### W. Public website & discovery (26 screens)

Public Rudra website and editorial CMS.

| ID | Screen / route | Access | Working controls & links | Authoritative objects |
|---|---|---|---|---|
| **W001** | **Homepage**<br>`/` | Public | Explore tests→W003; Packages→W005; Book→W007; Chat→A001 | CMS, catalog, campaign, lead attribution |
| **W002** | **About Rudra & Metropolis relationship**<br>`/about` | Public | Services→W006; Locations→W012; Contact→W021 | CMS, franchise-approved brand wording |
| **W003** | **Test catalogue**<br>`/tests` | Public | Search/filter; Test details→W004; Add to booking→W007 | Catalog search, prices, eligibility, location |
| **W004** | **Test detail & preparation**<br>`/tests/:slug` | Public | View approved prep; Price; Add to cart→W007; Ask question→A001 | Test version, requirements, medically approved copy |
| **W005** | **Health package catalogue**<br>`/packages` | Public | Compare packages; Male/female filters; Details→W006; Book→W007 | Package variants, promotional eligibility |
| **W006** | **Package detail & comparison**<br>`/packages/:slug` | Public | Components; Price/offer conditions; Compare; Book→W007 | Component versions, eligibility, consented pricing |
| **W007** | **Public booking stepper**<br>`/book` | Public/verified patient | Choose service/patient/date/collection; Price quote→W008; Sign in→W017 | Booking draft, patient identity, slot holds, consent |
| **W008** | **Booking review & confirmation**<br>`/book/review` | Public/verified patient | Verify fee; Confirm; Pay→W009; Edit→W007 | Quote snapshot, order, appointment, disclosure |
| **W009** | **Online payment checkout**<br>`/checkout/:order` | Verified payer | Pay securely; Retry; Confirmation→W010; Help→W021 | Gateway intent, receipts, idempotency |
| **W010** | **Booking success & next steps**<br>`/booking/success/:id` | Verified payer | View journey→P005; Receipt→P010; Get preparation→W004 | Order, appointment, notification |
| **W011** | **Home sample collection service**<br>`/home-collection` | Public | Check service area→W013; Book→W007; FAQ→W022 | Location zones, fees, staffing policies |
| **W012** | **Find centres**<br>`/centres` | Public | Search map/list; View centre→W013; Directions/call | Centre directory, operational hours |
| **W013** | **Centre profile & serviceability**<br>`/centres/:id` | Public | Contact; Directions; Service hours; Book→W007 | Centre, region, approved capabilities |
| **W014** | **Order tracking entry**<br>`/track` | Public/verified patient | Enter reference/verify identity; Journey→P005; Support→W021 | Identity verification, order lookup |
| **W015** | **Report access entry**<br>`/reports` | Public/verified patient | Sign in/verify→W017; My reports→P009 | Authentication and report authorization |
| **W016** | **Sign up / patient registration**<br>`/register` | Public | Identity; OTP; Consent; Create patient→P001 | Identity, duplicate resolution, consent |
| **W017** | **Login / OTP / recover access**<br>`/login` | Public | OTP/passkey when configured; Recovery; Redirect by role | Authentication, sessions, anti-abuse |
| **W018** | **Corporate diagnostics landing**<br>`/corporate` | Public | Services; Request quote→C007; Lead submit | Corporate lead, source attribution |
| **W019** | **Doctors & referrals landing**<br>`/doctors` | Public | Submit partnership enquiry→C002; Services | Doctor/partner leads, verification |
| **W020** | **Partner/franchise enquiry**<br>`/partner` | Public | Enquire→C012; Business terms disclaimer | B2B lead pipeline |
| **W021** | **Contact & help centre**<br>`/contact` | Public | Call; WhatsApp; Create enquiry→A006; Complaint→P013 | Support cases, routing, locations |
| **W022** | **Frequently asked questions**<br>`/faq` | Public | Topic search; Ask AI→A001; Support→W021 | Approved knowledge articles |
| **W023** | **Health education / blog**<br>`/health-guides` | Public | Browse/search; Article→W024; Book relevant test→W007 | CMS, medical review, SEO |
| **W024** | **Health article detail**<br>`/health-guides/:slug` | Public | View citations/review date; Share; Enquire | Editorial approvals, publication |
| **W025** | **Promotions & offers**<br>`/offers` | Public | Terms/eligibility; Book→W007 | Versioned promos, campaign attribution |
| **W026** | **Privacy, terms, disclosures & accessibility**<br>`/legal/:page` | Public | Review legal docs; Manage cookie choices; Contact privacy team | Notices, consent, policy revisions |

### P. Patient, account & family experience (16 screens)

Logged-in patient and consented family portal.

| ID | Screen / route | Access | Working controls & links | Authoritative objects |
|---|---|---|---|---|
| **P001** | **Patient home / health overview**<br>`/account` | Patient | Next action→P005; Book→W007; Family→P003; Reports→P009 | Patient overview, safe notifications |
| **P002** | **My profile & identity**<br>`/account/profile` | Patient | Edit permitted fields; Verify contact; Manage preferences | Patient, contacts, verification audit |
| **P003** | **Family dashboard**<br>`/account/family` | Patient/authorized guardian | List authorized members; Add/link→P004; Switch profile→P001 | Family relationship, consent, guardianship |
| **P004** | **Member 360 & access management**<br>`/account/family/:id` | Authorized family member/guardian | Review member; Book→W007; Reports→P009 only when authorized; Revoke access | Per-person ACL, relation proofs |
| **P005** | **Order care-journey timeline**<br>`/account/orders/:id/journey` | Patient | View confirmed events; Upcoming steps; Request help→P013 | Order events, projections, ETA policies |
| **P006** | **My bookings & appointments**<br>`/account/appointments` | Patient | Reschedule/cancel within policy→P007; Book again→W007 | Appointment, capacity, change history |
| **P007** | **Reschedule / cancel request**<br>`/account/appointments/:id/change` | Patient | Check policy/slots; Submit; Confirm changes | Appointment transition, refund rules, tasks |
| **P008** | **Orders & sample history**<br>`/account/orders` | Patient | Search/filter; Order→P005; Rebook; Invoice→P010 | Order, samples, linked external references |
| **P009** | **My medical reports & sharing**<br>`/account/reports` | Patient/authorized member | View/download authenticated; Secure share/revoke | Report access policy, immutable provenance |
| **P010** | **Bills, receipts & payment history**<br>`/account/billing` | Patient/payer | View issuer; Pay balance→W009; Download eligible document | Billing ledger, receipts, legal issuer |
| **P011** | **Addresses & collection preferences**<br>`/account/addresses` | Patient | Add/edit address; Save instructions; Location validation | Addresses, geozones, preferences |
| **P012** | **Health calendar & reminders**<br>`/account/calendar` | Patient | View scheduled tests; Manage reminders; Book→W007 | Appointments, preferences, clinician-guided recalls |
| **P013** | **Help, complaints & support tickets**<br>`/account/support` | Patient | Create ticket; Add details; Track resolution; Human contact | Tickets, service-level targets, messages |
| **P014** | **Notifications and channel preferences**<br>`/account/notifications` | Patient | Read alerts; Select communication channels; Opt out | Notification events, consent, DND |
| **P015** | **Document vault / health passport**<br>`/account/health-documents` | Patient | Upload permitted docs; Share/revoke; View trends→P016 | Encrypted documents, provenance |
| **P016** | **Comparable health trends**<br>`/account/health-trends` | Patient | Choose analyte/period; See comparability notes; Share with clinician | Clinically reviewed structured results |

### R. Reception, core CRM & front desk (18 screens)

Front desk and core patient records.

| ID | Screen / route | Access | Working controls & links | Authoritative objects |
|---|---|---|---|---|
| **R001** | **Staff workspace home**<br>`/staff` | Authenticated staff | My actions→O006; Appointments→R007; Queue→R011; Inbox→A004 | Personal work summary, scoped jobs |
| **R002** | **Patient search & duplicate review**<br>`/crm/patients` | Reception/CRM | Search minimum identifiers; Open→R003; Create→R004; Merge request→R005 | Identity resolution, scope and audit |
| **R003** | **Staff Patient 360°**<br>`/crm/patients/:id` | Authorized CRM users | Timeline→R006; Family→R005; Order→R009; Billing→B002; Contact | Patient 360, restricted access |
| **R004** | **Register / update patient**<br>`/crm/patients/new` | Authorized reception | Validate; Check duplicate; Capture notice/consent; Save→R003 | Patient, contact, consent, validation |
| **R005** | **Family links / dedup / consent**<br>`/crm/families` | Authorized CRM/admin | Link/verify relationships; Propose merge; Approve controlled merge | Family, duplicate candidates, permissions |
| **R006** | **Full patient activity timeline**<br>`/crm/patients/:id/timeline` | Authorized staff | View operational events; Add authorized note; Open order→R010 | Cross-domain timeline, provenance |
| **R007** | **Appointment calendar**<br>`/staff/appointments` | Reception/manager | Filter centre/staff; New→R008; Reschedule; Assign | Scheduling, capacity, assignments |
| **R008** | **Create / edit appointment**<br>`/staff/appointments/new` | Reception/manager | Select verified patient, slots, centre, collection; Save→R009 | Appointment, serviceability, availability |
| **R009** | **Create test order / quote**<br>`/staff/orders/new` | Authorized reception | Add tests; Eligibility; Fee; Confirm→R010; Billing→B002 | Catalog, order, quote snapshot |
| **R010** | **Order detail & status hub**<br>`/staff/orders/:id` | Staff scoped to order | Open journey→L016; Assign→F002; Payments→B002; Reports→L013 | Order, appointments, samples, statuses |
| **R011** | **Walk-in tokens and queue**<br>`/staff/queue` | Reception/branch | Check in; Issue token; Call next; Mark no-show; Redirect to R008 | Queue events, capacity |
| **R012** | **Today arrivals / check-in**<br>`/staff/check-in` | Reception/branch | Scan booking QR; Verify patient; Confirm arrival; Next task | Appointment, identity, check-in |
| **R013** | **Leads inbox & capture**<br>`/crm/leads` | Reception/sales | Create lead; Qualify; Assign; Convert→R004/R008 | Lead, attribution, consent, pipeline |
| **R014** | **Lead detail / follow-up**<br>`/crm/leads/:id` | Assigned sales/support | Notes; Callback; Quote; Convert; Close with reason | Lead activity, tasks, campaign origin |
| **R015** | **Calls / enquiries / callbacks**<br>`/staff/enquiries` | Reception/support | Log call; Tag enquiry; Create task; Link patient/lead | Communication records, tickets |
| **R016** | **Test catalogue lookup (staff)**<br>`/staff/catalogue` | Staff | Search approved test, method, prep, timing; Add to order→R009 | Versioned test/product catalogue |
| **R017** | **Price & offer quotation**<br>`/staff/quotes` | Authorized reception | Metropolis pricing; Evaluate promo; Manual home fee; Send approved quote | Price policy, quote version, consent |
| **R018** | **Front desk shift handover**<br>`/staff/handover` | Reception/centre manager | Review pending queues/cash/issues; Acknowledge; Transfer owner | Shift records, assigned tasks, audit |

### F. Home collection & field staff (15 screens)

Phlebotomist mobile and field operations.

| ID | Screen / route | Access | Working controls & links | Authoritative objects |
|---|---|---|---|---|
| **F001** | **Phlebotomist today dashboard**<br>`/field/today` | Phlebotomist | See jobs and priority; Open job→F003; Check availability→F014 | Assignments, current route, task state |
| **F002** | **Assign & schedule collection**<br>`/ops/collections/dispatch` | Dispatcher/manager | Check capacity/location; Assign staff; Confirm and notify | Home visits, rosters, ETA |
| **F003** | **Assigned collection job detail**<br>`/field/jobs/:id` | Assigned staff | Review patient and approved prep; Contact; Accept→F004; Report issue→F012 | Job, least-privilege patient info |
| **F004** | **Accept / reject / start job**<br>`/field/jobs/:id/start` | Assigned staff | Accept; Decline with reason; Start travel; Event log→F006 | Task states, provenance |
| **F005** | **Route and directions**<br>`/field/route` | Assigned staff | View route; Navigate in map app; Reorder only if authorized | Assigned route, geolocation minimization |
| **F006** | **En-route, arrival & ETA updates**<br>`/field/jobs/:id/travel` | Assigned staff | Mark out-for-collection; Arrived; Delayed; Customer alert | Verified travel events, notification |
| **F007** | **Pre-collection checklist**<br>`/field/jobs/:id/checklist` | Qualified staff | Confirm identity, consent, fasting/prep, supplies, special instructions | Approved SOP, acknowledgements |
| **F008** | **Sample collection and barcode scan**<br>`/field/jobs/:id/collect` | Qualified staff | Scan unique label; Record actual collection; Capture deviations | Specimen, time, collector, chain-of-custody |
| **F009** | **Collection payment / service charge**<br>`/field/jobs/:id/payment` | Authorized field staff | Show quote; Record cash/UPI reference; Issue permitted acknowledgement | Charge, payment evidence, reconciliation |
| **F010** | **Collection complete / patient confirmation**<br>`/field/jobs/:id/complete` | Assigned staff | Review sample count; Mark collected; Capture permitted acknowledgement | Sample collection, event, notification |
| **F011** | **Branch handover preparation**<br>`/field/handover` | Assigned staff | Select samples; Scan IDs; Submit for branch receipt→L003 | Transfer manifest, custody pending |
| **F012** | **Collection exception / recollection**<br>`/field/jobs/:id/issue` | Assigned staff | Record no-show, failure, insufficient specimen; Create rebook/recollection | Incident, sample issue, task escalation |
| **F013** | **Field communications / urgent support**<br>`/field/support` | Assigned staff | Message dispatcher; Escalate concern; Log incident | Internal case, work chat, escalation |
| **F014** | **Availability, shift & attendance**<br>`/field/schedule` | Field staff/manager | View schedule; Clock-in per policy; Leave/request change | Rosters, attendance, schedule |
| **F015** | **Mobile offline work queue**<br>`/field/offline` | Field staff | View locally permitted jobs; Queue encrypted status actions; Sync with validation | Offline queue, security, replay/conflicts |

### L. Branch, sample logistics, lab & reports (17 screens)

Custody chain and verified partner updates.

| ID | Screen / route | Access | Working controls & links | Authoritative objects |
|---|---|---|---|---|
| **L001** | **Branch operations overview**<br>`/branch` | Branch staff/manager | Pending receipts, dispatches, overdue reports; Open samples→L002 | Centre workload, exceptions |
| **L002** | **Samples queue / scan station**<br>`/branch/samples` | Authorized sample staff | Scan; Find manifest; Review statuses; Receive→L003 | Sample register, barcode identity |
| **L003** | **Branch sample receiving**<br>`/branch/receive` | Authorized receiving staff | Match label/manifest; Accept or flag; Record receipt by staff | Transfer custody, receiving evidence |
| **L004** | **Sample condition & rejection review**<br>`/branch/quality-check` | Qualified authorized staff | Checklist; Accept; Quarantine/reject with reason→L010 | Sample conditions, SOP versions |
| **L005** | **Dispatch planning & batches**<br>`/branch/dispatch` | Dispatch staff | Build batch; Confirm packaging; Pick destination; Print manifest | Shipment, sample links, temperature rules |
| **L006** | **Driver / courier handover**<br>`/branch/handover` | Authorized logistics staff | Scan batch; Sender/receiver confirmation; Record departure | Transport custody, signatures where required |
| **L007** | **In-transit shipment tracking**<br>`/branch/transit` | Logistics staff/manager | View actual handovers; Record verified milestones; Escalate delay | Shipment, journey events |
| **L008** | **Metropolis reference mapping**<br>`/integrations/metropolis/links` | Authorized branch/operator | Enter external patient/order/sample refs; Verify collisions; Save | External ref registry, referential checks |
| **L009** | **Manual Metropolis status update**<br>`/integrations/metropolis/status` | Authorized operator | Select order and verified source; Enter factual status; Attach evidence | External event, provenance, dual approval if needed |
| **L010** | **Sample rejection & recollection queue**<br>`/branch/recollection` | Branch/manager | Rejection reasons; Notify customer; Assign new collection→F002 | Recollection cases, lineage, quality |
| **L011** | **Partner lab receipt & processing view**<br>`/branch/lab-progress` | Authorized operational staff | Show confirmed status, pending confirmations; Flag unverified | Verified external events, mapping |
| **L012** | **Metropolis import & validation review**<br>`/integrations/metropolis/imports` | Authorized integration operator | Upload approved CSV; Preview mapping; Validate; Confirm import | Import job, quarantine, dedupe |
| **L013** | **Report intake & secure document linking**<br>`/branch/reports/intake` | Report-authorized staff | Upload/link authorized report; Verify patient/order; Check provenance | Encrypted report, verification, scope |
| **L014** | **Report availability / delivery workflow**<br>`/branch/reports/deliver` | Authorized reporting/support staff | Confirm authorized release; Notify verified recipient; Record delivery | Report status, delivery proof, consent |
| **L015** | **Partial reports, corrections & revocations**<br>`/branch/reports/exceptions` | Authorized clinical/reporting operator | Identify partial/revised reports; Supersede access; Re-notify safely | Report versioning, correction audit |
| **L016** | **Operational order journey**<br>`/staff/orders/:id/journey` | Authorized staff | Inspect actual/planned events; Correct with trace; Escalate; Patient preview→P005 | Timeline/event engine, permissions |
| **L017** | **Critical results & urgent escalation**<br>`/branch/critical-alerts` | Authorized clinical coordinator | Follow approved protocol; Notify qualified professional; Record acknowledgement | Critical result workflow, restricted access |

### B. Billing, payments & finance (15 screens)

Issuer-aware financial operations.

| ID | Screen / route | Access | Working controls & links | Authoritative objects |
|---|---|---|---|---|
| **B001** | **Billing overview / work queue**<br>`/finance/billing` | Reception/accounts | Pending invoices, overdue, disputes; Open order→B002 | Billing records, issuer and status |
| **B002** | **Generate / link order bill**<br>`/finance/orders/:id/bill` | Authorized billing staff | Choose authorized issuer; Preview; Issue/link existing; Avoid duplicate legal invoice | Order charges, invoice issuance control |
| **B003** | **Quotes & charge editor**<br>`/finance/quotes/:id` | Authorized staff | Diagnostic price locked; Set home fee 0/75/99/150/custom; Approve overrides | Price snapshot, home fee, audit |
| **B004** | **Invoice / receipt viewer**<br>`/finance/invoices/:id` | Authorized staff/patient as scoped | Preview issuer/tax details; Print/download; Correct by authorized adjustment | Invoice legal entity, immutable issue refs |
| **B005** | **Record payment / payment link**<br>`/finance/payments/new` | Authorized finance staff | Cash/UPI/card/gateway; Verify transaction; Generate receipt | Payments, gateway refs, idempotency |
| **B006** | **Payment ledger / allocations**<br>`/finance/payments` | Accounts | Match transactions to bills; Split/allocate; Review unapplied items | Ledger entries, payment records |
| **B007** | **Refunds / cancellations / adjustments**<br>`/finance/refunds` | Approver/accounts | Submit reason/evidence; Approval; Execute via authorized method | Refund workflow, approvals, audit |
| **B008** | **Outstanding dues & collections**<br>`/finance/outstanding` | Accounts | Filter unpaid/part-paid; Reminder with consent; Reconcile payment | Balances, collection tasks |
| **B009** | **Daily cash & UPI close**<br>`/finance/daily-close` | Accounts/centre manager | Count cash; Match UPI; Explain variances; Lock close | Shift totals, discrepancy case |
| **B010** | **Metropolis settlement ledger**<br>`/finance/metropolis` | Accounts/owner | Record bills, credits, remittances; Reconcile external references | Settlement, partner invoices, rules pending |
| **B011** | **Home collection income ledger**<br>`/finance/home-fees` | Accounts/owner | Separate service fees; Waiver reports; Compare collection expenses | Home charge, accounting, tax setup |
| **B012** | **Corporate & partner invoicing**<br>`/finance/partner-billing` | Accounts/corporate manager | Batch authorized bills; Credit terms; Invoice issuer and approval | Contract, corporate account, ledger |
| **B013** | **Expense & petty cash**<br>`/finance/expenses` | Accounts/manager | Enter receipt; Category; Approval; Reconcile | Expenses, payable, approval |
| **B014** | **Financial analytics & exports**<br>`/finance/analytics` | Owner/accounts | Revenue, cost, variance, by-centre reports; Export scoped records | Financial aggregate, reporting |
| **B015** | **Disputes / invoice corrections**<br>`/finance/disputes` | Accounts/authorized approver | Register issue; Verify issuing party; Credit/debit note process | Case, adjustment, external ref |

### C. Doctor, corporate, B2B & partner CRM (12 screens)

Relationship and institutional business.

| ID | Screen / route | Access | Working controls & links | Authoritative objects |
|---|---|---|---|---|
| **C001** | **Doctor CRM directory**<br>`/relationships/doctors` | Sales/manager | Search; Add→C002; Open profile→C003 | Doctor master, consent/communications |
| **C002** | **Doctor onboarding / verification**<br>`/relationships/doctors/new` | Authorized relationship staff | Verify professional details; Capture contact permissions; Approve | Doctor identity, vetting, audit |
| **C003** | **Doctor 360 & referral relationship**<br>`/relationships/doctors/:id` | Authorized relationship staff | Orders/refs within authority; Tasks; Visits; Issues | Referral association, activity |
| **C004** | **Doctor visit plan & field log**<br>`/relationships/doctor-visits` | Assigned sales staff | Plan visit; Check in; Meeting summary; Follow-up | Visit activities, location policy |
| **C005** | **Referral source & attribution**<br>`/relationships/referrals` | Manager/authorized sales | Link consented referral; Reconcile attribution; Report | Source tags, policies, avoid inducements |
| **C006** | **Corporate accounts directory**<br>`/corporates` | Sales/corporate manager | Search; Create→C007; Open→C008 | Corporate lead/account |
| **C007** | **Corporate lead, quotation & contract**<br>`/corporates/new` | Corporate sales | Prepare proposal; Approval; Contract terms; Convert→C008 | Quote, contract, negotiated rates only if allowed |
| **C008** | **Corporate 360 / program dashboard**<br>`/corporates/:id` | Corporate manager | Campaigns→C009; Billing→B012; Assigned coordinator | Corporate account, contracts, case lists |
| **C009** | **Corporate camp / employee scheduling**<br>`/corporates/:id/camps` | Corporate operator | Create camp; Slot capacity; Onsite staff; Check-ins | Events, rosters, separate employee privacy |
| **C010** | **B2B partner directory & onboarding**<br>`/partners` | Partnerships staff | Add/verify; Assign rate/permissions; Activate→C011 | Partner account, contract, auth |
| **C011** | **Partner portal & sample orders**<br>`/partner/portal` | Authorized B2B partner | Create authorized order; Print labels; Track verified status; Bills/reports | Partner-specific tenancy, referrals, samples |
| **C012** | **Partnership pipeline / contracts**<br>`/relationships/pipeline` | Sales/owner | Enquiries; Due diligence; Sign/renew; Create tasks | Leads, contracts, approvals |

### A. Communications, customer support & AI (13 screens)

Unified conversations and channel actions.

| ID | Screen / route | Access | Working controls & links | Authoritative objects |
|---|---|---|---|---|
| **A001** | **Website Rudra AI chat**<br>`/chat` | Visitor/verified patient | Ask approved FAQs; Link to booking→W007; Human transfer→A006 | Knowledge RAG, tools, consent, handoff |
| **A002** | **WhatsApp automation configuration**<br>`/communications/whatsapp` | Channel admin | Connect approved WABA; Template review; Opt-in; Test routing | Provider adapters, template status |
| **A003** | **AI calling / receptionist configuration**<br>`/communications/voice` | Owner/AI manager | Number routing; Scripts; Language; Escalation; Consent rules | Telephony connector, agent policy |
| **A004** | **Unified inbox**<br>`/communications/inbox` | Customer support/authorized staff | Filter WhatsApp/web/phone/social; Assign; Respond; Open patient→R003 | Channel threads, identity match |
| **A005** | **Conversation detail & context**<br>`/communications/conversations/:id` | Assigned support user | Review permissioned history; Notes; Reply; Create booking/ticket | Thread, patient scope, agent log |
| **A006** | **Customer support ticket queue**<br>`/support/tickets` | Support/manager | Assign priority; SLA; Open→A007; Resolve | Ticket, escalation, audit |
| **A007** | **Ticket detail / resolution**<br>`/support/tickets/:id` | Support/manager | Contact; Internal note; Escalate; Close with resolution | Case messages, outcomes, permission |
| **A008** | **AI knowledge library**<br>`/ai/knowledge` | Authorized curator/medical reviewer | Draft verified entries; Source/version; Clinical review; Publish | Knowledge items, approval, expiration |
| **A009** | **AI conversations review & quality**<br>`/ai/reviews` | AI supervisor | Flag hallucinations; Audit tool actions; Feedback; Rollback knowledge | AI transcripts, evaluation, redaction |
| **A010** | **Outbound communications / campaigns**<br>`/communications/outbound` | Authorized support/marketing | Segment with consent; Approve template; Send; Suppress opt-outs | Campaign, channel limits, consent |
| **A011** | **Call history, recordings & dispositions**<br>`/communications/calls` | Authorized support/QA | Search logs; Review where lawful; Mark disposition; Follow up | Call metadata, recording control |
| **A012** | **Missed call & failed chat recovery**<br>`/communications/recovery` | Support/automation manager | Queue callbacks; Assign human; Suppress duplicates | Missed contacts, callback tasks |
| **A013** | **Notification templates & delivery audit**<br>`/communications/notifications` | Channel admin | Edit permitted templates; Test; View failures/retry | Template, delivery, consent, queue |

### M. Social media, content & digital marketing (18 screens)

Owner-governed marketing operations.

| ID | Screen / route | Access | Working controls & links | Authoritative objects |
|---|---|---|---|---|
| **M001** | **Marketing home dashboard**<br>`/marketing` | Marketing/owner | View performance; Approval queue→M006; Campaigns→M012 | Attribution, connected accounts, action items |
| **M002** | **Connected channels/account health**<br>`/marketing/accounts` | Owner/marketing admin | Authorize/revoke platform; Check sync errors; Assign permissions | OAuth scopes, account mappings, audits |
| **M003** | **Content studio & drafts**<br>`/marketing/studio` | Creator/marketing staff | Draft post/reel/article; Attach approved assets; Submit→M006 | Content records, versioned drafts |
| **M004** | **Brand and media asset library**<br>`/marketing/assets` | Approved creator | Upload assets; Metadata; License/consent; Reuse→M003 | DAM, usage rights, approvals |
| **M005** | **Editorial calendar / campaign schedule**<br>`/marketing/calendar` | Marketing staff | Calendar view; Schedule approved item; Move draft; Open→M003 | Editorial plan, publishing tasks |
| **M006** | **Content medical/brand approval queue**<br>`/marketing/approvals` | Owner/approved reviewer | Review claims/rights; Approve/reject; Escalate; Lock version | Approval chain, compliance history |
| **M007** | **Publishing queue & channel results**<br>`/marketing/publishing` | Authorized publisher | Publish approved assets; Retry errors; Record manual publish evidence | Platform publishing adapters, audit |
| **M008** | **Instagram / Facebook content workspace**<br>`/marketing/meta` | Marketing authorized | Channel posts, comments, insights where supported; Escalate to A004 | Meta platform scopes, social data |
| **M009** | **YouTube / video content workspace**<br>`/marketing/youtube` | Marketing authorized | Upload/schedule approved videos where supported; Analytics | YouTube channel adapter |
| **M010** | **LinkedIn / corporate campaigns**<br>`/marketing/linkedin` | Marketing authorized | Publish approved corporate material; Insights; Link leads→C006 | LinkedIn provider scopes |
| **M011** | **Google Business & reputation**<br>`/marketing/local` | Marketing/centre manager | Centre listings; Review queue; Prepare compliant replies | GBP authorized location manager |
| **M012** | **Campaign directory and planner**<br>`/marketing/campaigns` | Marketing owner/manager | Plan goals, audiences, budget; Approve; Launch→M013 | Campaign, budget ceilings, approval |
| **M013** | **Paid advertising oversight**<br>`/marketing/ads` | Ads manager/owner | Connect permitted ad accounts; Monitor; Pause; Request spend changes | Ad provider adapter, approvals |
| **M014** | **Landing pages & website CMS**<br>`/marketing/website` | Marketing editor | Draft landing/offer/article; Preview; Approve; Publish→W001/W025 | CMS, SEO, promo terms |
| **M015** | **SEO, search & site performance**<br>`/marketing/seo` | Marketing analyst | Search metrics; Technical issues; Assign content improvements | Web analytics, Search Console when connected |
| **M016** | **Social interactions / reputation inbox**<br>`/marketing/community` | Community manager | Reply to permitted comments/DMs; Case→A007; Escalate sensitive items | Social messages, CRM, privacy |
| **M017** | **Leads attribution & funnel**<br>`/marketing/attribution` | Marketing analyst/owner | Source→lead→booking→payment; Consent-safe insights | Attribution, booking references, aggregate stats |
| **M018** | **Marketing access, budgets & audit**<br>`/marketing/governance` | Owner/marketing admin | Granular access; Time-limit; Approve budget; Revoke | RBAC, budget limits, audit |

### O. Operations management, owner, quality & analytics (16 screens)

Cross-centre control and productivity.

| ID | Screen / route | Access | Working controls & links | Authoritative objects |
|---|---|---|---|---|
| **O001** | **Owner command centre**<br>`/owner` | Owner/super admin | Cross-centre KPIs; Open issues→O006; Financial→B014; Marketing→M001 | Aggregated metrics, drilldowns |
| **O002** | **Centre manager dashboard**<br>`/manage` | Centre manager | Staff load, collection progress, unresolved issues; Assign→O005 | Centre-scoped metrics |
| **O003** | **Multi-centre directory & settings**<br>`/manage/centres` | Owner/admin | Create centre; Areas; Working hours; Service capabilities | Centre/geo permissions, onboarding |
| **O004** | **Service area & capacity manager**<br>`/manage/capacity` | Centre manager/dispatcher | Zones, slots, holiday capacity; Approve overrides | Serviceability, schedule rules |
| **O005** | **Staffing, rostering & work allocation**<br>`/manage/roster` | Manager | Assign staff, leave cover, capacity; Publish shifts→F014 | Staff schedules, attendance, fairness |
| **O006** | **Rudra Action Centre**<br>`/actions` | Staff/manager/owner scoped | Approve/assign/escalate tasks; Filter my centre; Open source item | Unified tasks, SLA and authorization |
| **O007** | **Operational SLA & escalation policies**<br>`/manage/slas` | Owner/ops admin | Configure alerts, thresholds, notification recipients; Test rules | Rules engine, escalation history |
| **O008** | **Quality incidents & corrective action**<br>`/quality/incidents` | Quality manager | Report incident; Investigate; Assign CAPA; Close with evidence | Incident, CAPA, SOP references |
| **O009** | **SOP library & staff training**<br>`/quality/sops` | Authorized manager/staff | Version SOP; Acknowledge; Assign training; Check completion | SOP content, training evidence |
| **O010** | **Inventory dashboard & stock movements**<br>`/inventory` | Store/manager | Stock/expiry; Receive/issue/transfer; Reconcile | Consumables inventory, batches |
| **O011** | **Procurement & reorder approvals**<br>`/inventory/purchasing` | Procurement/owner | Request, approve, PO, receipt; Track supplier | Purchase orders, spend permissions |
| **O012** | **Complaints, service quality & CSAT**<br>`/quality/service` | Manager/quality | Review complaint patterns; Recovery tasks; Customer outcomes | Support cases, quality metrics |
| **O013** | **Productivity, route & workforce analysis**<br>`/analytics/operations` | Manager/owner | Completed vs assigned; Delays; Staff efficiency; Export | Event aggregates, limited location |
| **O014** | **Growth and revenue intelligence**<br>`/analytics/business` | Owner | Repeat rates, channels, centre performance; Reconcile facts | Aggregated CRM, finances, attribution |
| **O015** | **Audit, compliance & access anomalies**<br>`/manage/audit` | Authorized compliance/owner | Filter change history; Investigate; Export under controls | Immutable audit, threat events |
| **O016** | **Business continuity & health monitor**<br>`/manage/health` | Owner/IT admin | Integration/outage alarms; Manual mode; Recovery readiness | Operational telemetry, backups, queue |

### S. Identity, settings, governance & platform (12 screens)

Cross-cutting platform administration.

| ID | Screen / route | Access | Working controls & links | Authoritative objects |
|---|---|---|---|---|
| **S001** | **Staff login, MFA & session management**<br>`/staff/login` | Staff/admin | Authenticate; MFA; Logout/session list; Recovery policy | Identity, device/session management |
| **S002** | **User and staff directory**<br>`/admin/users` | Owner/HR/admin | Invite; Suspend; Centre assign; Open access→S003 | Staff identity, audit |
| **S003** | **Roles and fine-grained permissions**<br>`/admin/access` | Owner/super admin | Grant role; Restrict centre/channel; Time limit; Revoke | RBAC/ABAC, approval boundary |
| **S004** | **Consent and privacy console**<br>`/admin/privacy` | Privacy admin | View consent provenance; Fulfil rights requests; Retention/deletion workflows | Data mapping, lawful basis, approvals |
| **S005** | **System configuration & feature flags**<br>`/admin/config` | Owner/IT admin | Turn on licensed modules; Centre configs; Versioned changes | Settings, flags, audit |
| **S006** | **Metropolis adapter & import configuration**<br>`/admin/integrations` | Authorized integration admin | Configure manual or authorized provider; Map fields; Test | Adapter settings, least-privilege secrets |
| **S007** | **Integration events & failure resolution**<br>`/admin/integration-events` | Integration admin | See failures; Retry idempotently; Resolve conflicting sources | Sync queue, error audit |
| **S008** | **Catalogue price/promotions governance**<br>`/admin/catalogue` | Owner/authorized catalog admin | Import source; Approve version; Publish; Expire offer | Versioned test master, offers, authorization |
| **S009** | **Document templates & legal issuers**<br>`/admin/documents` | Owner/accounts/compliance | Configure invoice issuer, consent and report-cover templates | Templates, legal entity, versions |
| **S010** | **Backups, exports and recovery console**<br>`/admin/recovery` | Authorized IT/owner | Review backup tests; Request encrypted export; Recovery approval | Restore drills, data export audit |
| **S011** | **Notifications, integrations & task automation admin**<br>`/admin/automation` | IT/owner | Configure approved rules; Dry-run; Retry/disable failing job | Workflow policies, scheduler, queues |
| **S012** | **Change log, release and acceptance dashboard**<br>`/admin/releases` | Owner/IT/QA | Requirements→tests; Evidence; Gate staged rollout; Rollback | Release registry, feature coverage |

## C2. Detailed functional contracts for high-impact screens

The complete 178-screen table above is the stable inventory. The following contracts define the expected **zones, controls, write operations, and failure behavior** for the most important interfaces. Every other screen follows the common screen contract in section G.

### W001 — Public homepage
- **Zones**: Rudra brand/franchise disclosure; navigation; search tests and packages; booking/home collection CTA; approved promotions; centres/serviceability; verified trust information; support/chat; footer legal.
- **Working controls**: catalogue search (`W003`), package browser (`W005`), booking (`W007`), centre finder (`W012`), login (`W017`), chat (`A001`); every lead-capture control creates a traceable lead with consent.
- **Read models**: published, effective catalogue and promotions, CMS versions, centre availability. **No dynamic promotional price** without owner-approved version.
- **Failure**: unavailable slot/service zone or unpublished promotion never displays as bookable; show callback/manual enquiry alternative.

### W007 — Booking stepper
- **Zones**: patient/authorized family selection; test items; home versus centre collection; location; slot; preparation disclosure; quote; consent; confirmation.
- **Working controls**: search/choose patient; OTP verify where necessary; select tests and package variant; choose address; slot hold; request custom home fee through authorized staff workflow; continue `W008`.
- **Writes**: a booking draft, patient association, quote snapshot, slot hold and consent evidence. No order finalization before validated final quote and slot confirmation.
- **Failure**: expired hold, double submit, invalid package, blocked service area, inaccessible family member, declined payment—all recover without duplicate records.

### P001 — Patient home
- **Zones**: greeting; next action/What's Next; my bookings; report availability; family switcher; bills; help; notification preference shortcut.
- **Working controls**: open patient journey `P005`, family `P003`, report `P009`, invoice `P010`, rebook `W007`, support `P013`.
- **Security**: patient-only information after verified session; hide medical content from push previews and public dashboards.

### P004 — Family Member 360°
- **Zones**: linked member profile, relationship/authority status, appointments, tests, reports (only when separately authorized), consent, caregiver permissions.
- **Controls**: link/request access, revoke, select booking patient, manage minor/guardian status, view report only when permitted.
- **Failure**: sharing invite expires; adult family member denies or revokes access; access token invalidates; appointment organization can remain possible without report disclosure.

### P005 — Care Journey timeline
- **Zones**: appointment header; current verified milestone; *next expected action*; vertical time-stamped milestones; sample status sub-events; billing lane; notifications; report link when authorized; support CTA.
- **Controls**: refresh/live-update, open booking `P006`, open report `P009`, view bills `P010`, request help `P013`; no patient control can directly overwrite clinical/partner statuses.
- **Read model**: timeline-event projection sorted by actual occurrence time with recorded-time provenance; pending steps labeled pending rather than completed. ETA is a policy-derived estimate, not a fabricated provider promise.
- **Failure**: absent laboratory feed shows “Awaiting laboratory confirmation”; late milestone opens support; revised reports use version labels.

### R003 — Staff Patient 360°
- **Zones**: identity and verification badge; authorized demographics; family relationships; contact/consent; encounter timeline; appointments/orders; invoices/payments; tasks/cases; report links only for approved roles.
- **Controls**: edit authorized fields `R004`, create order `R009`, book `R008`, open journey `R006`, billing `B002`, case `A007`, duplicate-review `R005`.
- **Failure**: ambiguous identity prompts merge review, never automatically merges records; a role without medical permission sees metadata only.

### R009 — Staff order builder
- **Zones**: patient verified identity, test/package search, Metropolis code, specimen and prep requirements, location/slot, price and promotion, manually controlled home fee, quote, billing link.
- **Controls**: add/remove tests with constraints; validate package variant; choose collection; confirm patient quote; create order; open `R010` and `B002`.
- **Writes**: order and order lines, unique public reference, immutable initial quote version, appointment link, tasks, event. Never book an unapproved inactive catalog item.

### F001 — Phlebotomist daily dashboard
- **Zones**: shift readiness, assigned jobs by time and locality, today's pending/completed/failed counts, route, task alerts, handover queue.
- **Controls**: accept/open `F003`; travel `F006`; collection `F008` only after identity/checklist; handover `F011`; incident `F012`; schedule `F014`.
- **Failure**: no-network offline queue `F015`; prevent assigning a job to an unauthorized staff member or outside active work eligibility.

### F008 — Sample collection & barcode
- **Zones**: verified patient/service order, approved specimen/tube requirements, fasting acknowledgment, sample/barcode set, collection actual time, deviation capture.
- **Controls**: scan each sample, validate no wrong patient/duplicate barcode, mark specimen collected, record exception `F012`, complete `F010`.
- **Writes**: sample IDs, barcodes, linked order line, collection staff, actual collection event, sample condition. No clinical result is generated here.
- **Failure**: missing consent, sample mismatch, incomplete SOP or patient identification blocks “complete” until resolved via approved override/escalation.

### L003 — Sample receiving at Rudra branch
- **Zones**: arriving manifest, scanned specimens, expected-vs-received, condition and packaging check, receiver identity, exceptions.
- **Controls**: scan; acknowledge received; quarantine/flag discrepancy `L004`; print receipt; start dispatch preparation `L005`.
- **Writes**: custody transfer with distinct sender and recipient confirmations, timestamp and evidence. The phlebotomist's “submitted” alone does not equal “received”.
- **Failure**: missing sample remains outstanding; wrong barcode or unlabeled specimen requires incident workflow.

### L009 — Manual external Metropolis status update
- **Zones**: linked Rudra order, external Metropolis reference, last verified external status, new status, observed time, evidence/reference, warning banner.
- **Controls**: select only permitted state transitions; attach authorized source; submit verification; second-person approval for configured sensitive statuses; reverse only by compensating correction.
- **Writes**: external-status event with actor, source and source document/reference. Patient-facing display appears only after configured verification rules pass.
- **Failure**: no external proof leaves status pending; contradictory imported/API status goes to `S007` reconciliation rather than silently overriding.

### L013 — Report intake
- **Zones**: order/patient matching, external report origin, lab issuer, versions, verification, secure viewer, release eligibility.
- **Controls**: attach permitted report, match exact patient/order, review original lab authorization, flag mismatch, hand over to `L014`.
- **Failure**: unmatched or unverified report stays quarantined; no patient notification/availability until authorized release conditions are met.

### B002 — Issuer-aware billing
- **Zones**: confirmed order lines, active quote snapshot, home fee line, applicable taxes/adjustments, legal invoice issuer, previous invoice links, payment status.
- **Controls**: choose a configured billing path; issue legal Rudra document **only if authorized**; otherwise attach Metropolis-issued document; link existing bill; collect payment `B005`.
- **Rules**: prevent a second legal invoice for the same diagnostic supply; use a separate legitimate Rudra service document where appropriate; preserve immutable invoice number and settlement references.
- **Failure**: issuer not configured or external invoice unavailable means “billing pending” or a permitted estimate, never a fake tax invoice.

### A004 — Unified conversation inbox
- **Zones**: filtered work queue by channel/team/priority; identity verification state; patient/lead sidebar; approved knowledge suggestions; conversation; handoff/ticket actions.
- **Controls**: assign, reply, pause AI, transfer to human, request identity verification, create booking/task/case; all changes persist in CRM.
- **Failure**: no private report data in an unverified social DM or telephone session; communication provider failure retains failed/retryable status.

### A001 — Website AI assistant
- **Zones**: business-identified assistant, conversation with clear AI disclosure, tests/packages lookup, booking quick action, human help.
- **Controls**: ask FAQs, guided quote, start consented booking, call human. AI tools are allowlisted, role-scoped, confirmed for writes, rate-limited and traceable.
- **Safety**: no independent diagnosis or report interpretation; critical concerns trigger urgent human/medical-care guidance under approved policy; knowledge and pricing version visibly sourced internally.

### M003 — Content studio
- **Zones**: content brief, channel selection, media assets, captions and variants, rights check, medical claim sources, approval status and preview.
- **Controls**: save draft, branch variants, attach approved assets, submit for review `M006`, schedule only approved version via `M005`.
- **Failure**: content with patient identifiers, unlicensed photos or unsupported medical claims cannot be scheduled without resolution.

### M006 — Marketing approval queue
- **Zones**: content version, brand checklist, medically sensitive claim review, legal/privacy rights, final preview, reviewer identity.
- **Controls**: approve/reject/request changes; specify platforms and effective date; log exact approved version; budget gate separate in `M018`.
- **Failure**: approved text altered after approval becomes a new unapproved version; no silent auto-publication.

### M018 — Marketing delegation and spend guardrails
- **Zones**: staff accounts, connected social page permissions, channel/location scope, action toggles (view/draft/reply/schedule/publish/manage ads/spend/export), expiry, budget cap and revoke.
- **Controls**: owner grant/revoke access with MFA where appropriate, audit every delegation, require owner approval for above-cap spend.
- **Failure**: revoked accounts cannot publish through cached tokens; budget changes cannot bypass server-side caps.

### O001 — Owner Command Centre
- **Zones**: actual operations KPIs, actionable exceptions, sample pipeline, payments/settlement, marketing and AI performance, centre comparison, permission approvals.
- **Controls**: drill down to task `O006`, collection `F002`, finance `B014`, marketing `M001`, quality `O008` and admins `S003`.
- **Rules**: no invented counts, stale data labeled, all cross-centre accesses audited; sensitive patient clinical details filtered by role and purpose.

### O006 — Rudra Action Centre
- **Zones**: My Tasks, Approvals, Delays, Exceptions, Complaints, Integration Conflicts, Finance Discrepancies and Marketing Approvals.
- **Controls**: claim/assign/escalate/approve/deny/request evidence, set due time, open source screen. Job transitions happen transactionally with audit.
- **Failure**: approving a task without permission or expired authorization must fail; a completed item is not silently reactivated by stale page state.

### S003 — Roles and permissions
- **Zones**: user/role/centre/channel scope matrix, sensitive-action toggles, expiry, pending approvals, effective permission preview.
- **Controls**: grant/revoke, require MFA for elevation, simulate effective access, export audited change record.
- **Failure**: role escalation by non-owner denied; revocation invalidates sensitive tokens/sessions according to security policy.

## D. Required shared dialogs / reusable components (not new screens)

- Global command/search: exact-match Patient/Lead/Order/Sample lookups; minimum fields; scope filters; anti-enumeration.
- Date/time slot picker: timezone-aware, centre calendar, hold-expiry, no double booking.
- Quote/billing panel: source-versioned diagnostic price, promo rules, home-fee quick chips and authorized custom fee, total with correct tax treatment.
- Manual milestone modal: event code, actual occurrence timestamp, staff attribution, source/evidence, reason if correction, pending/verified distinction and post-save timeline preview.
- Barcode scanner/lookup: avoid duplicates; sample-to-order verification; fallback typing with second verification.
- Confirmation/approval dialog: irreversible actions, refunds, export, disclosure, bulk sends, editing issued financial documents.
- Family permission share modal: verified adult consent or legally supported guardian authority; expiry/revocation.
- Report viewer: strong identity checks, audit, expiry-controlled links, watermark if required, version/provenance.
- Activity / audit side panel: actor, event time, recorded time, channel, source, reason, previous/new state.
- Staff assignment panel: coverage, shift, capacity, current work and same-centre boundary.
- Communication composer: channel consent, delivery template, preview, anti-duplicate and send log.
- Complaint / incident modal: severity, evidence, accountable owner, escalation timer, resolution check.
- AI handoff drawer: sanitized conversation summary, explicit customer identity state, owner team and follow-up SLA.
- Content approval drawer: claims, medical review, brand rights, approved exact creative/version, target platform, spending limits.
- Offline conflict resolution: saved events pending sync, prevention of duplicate submissions and manual reconciliation.

## E. Core domain data model and contracts

**Master data**: `organization`, `centre`, `service_zone`, `staff`, `role`, `permission`, `patient`, `family_relationship`, `authorized_family_access`, `doctor`, `corporate`, `partner`, `lead`, `catalog_test`, `catalog_package`, `package_component`, `catalog_version`, `price_version`, `promotion`, `knowledge_article`, `sop`.

**Operational data**: `appointment`, `slot_capacity`, `order`, `order_line`, `quote`, `home_visit_fee`, `collection_job`, `assignment`, `sample`, `sample_transfer`, `shipment_manifest`, `external_reference`, `lab_update`, `report_document`, `report_version`, `timeline_event`, `task`, `incident`, `complaint`, `notification`.

**Commercial and growth**: `billing_case`, `invoice_issuer`, `invoice`, `invoice_external_reference`, `receipt`, `payment`, `payment_allocation`, `refund`, `adjustment`, `settlement`, `daily_close`, `contract`, `campaign`, `content_asset`, `content_approval`, `social_account`, `marketing_spend`, `attribution`, `conversation`, `call_record`, `message`, `consent_event`, `audit_event`.

**Persistent ID examples**: `RHC-PAT-000001`, `RHC-LEAD-000001`, `RHC-APT-000001`, `RHC-ORD-2026-000001`, `RHC-SMP-2026-000001`, `RHC-PAY-000001`, `RHC-INV-2026-000001`, `RHC-DOC-000001`, `RHC-COR-000001`, `RHC-PRT-000001`, `RHC-CEN-001`, `RHC-STF-000001`. Use immutable internal UUIDs as relational keys; business IDs are human-readable references, assigned atomically and never reused.

### Timeline event contract

Required `timeline_event` fields: `event_id`, `event_type`, `aggregate_type`, `aggregate_id`, `order_id` (where relevant), `patient_id` (where relevant), `sample_id` (when relevant), `occurred_at`, `recorded_at`, `actor_type`, `actor_id`, `source` (`staff`, `customer`, `provider_verified`, `import_verified`, `system`), `verification_status`, `before_state`, `after_state`, `reason`, `evidence_reference`, `visible_to_patient`, `idempotency_key`, `correction_of_event_id`, `centre_id`, `trace_id`.

- A manually entered **Metropolis laboratory status** must store documentary/source justification and be clearly labeled as staff-verified if it is not a provider API event.
- Future partner API integration maps into the same immutable timeline; duplicates (same external event ID/transition) must not produce duplicate notifications.
- Backdated events must preserve `recorded_at` separately from `occurred_at`; correction never overwrites the original event.
- “Completed” is not a generic editable free-text label: transitions must pass domain validation and actor permissions.
- Per-order status is a projection derived from validated events, not the only history source.
- Patient timeline redacts internal notes, staff-only identity data and unverified medical or logistics claims.

### Order and sample state machines

**Order**: `draft → quoted → confirmed → in_collection / awaiting_collection → sample_in_transit → at_branch → dispatched → lab_received_verified → processing_verified → partial_report → report_available → delivered → closed`; side paths `rescheduled`, `cancelled`, `on_hold`, `recollection_required`, `incident_open` with documented return paths. Real orders can have multiple sample lines; project a safe aggregate without hiding different specimen states.

**Collection job**: `requested → scheduled → assigned → accepted → en_route → arrived → collection_started → collected → handover_pending → handover_confirmed`; alternatives `declined`, `no_show`, `failed`, `cancelled`, `rescheduled`, `recollection_required`.

**Sample**: `label_created → collected → submitted_for_branch_receipt → branch_received → accepted_for_dispatch → dispatched → partner_received_verified → processed_verified / rejected`; recollection creates **a new sample ID** linked to the original.

**Payment** (parallel, not mandatory linear order path): `unpaid`, `partially_paid`, `paid`, `refund_pending`, `partially_refunded`, `refunded`, `disputed`; transaction/settlement confirmation controls state. Do not treat staff tapping “paid” as verified electronic settlement.

**Report**: `awaiting_external`, `received_unverified`, `verified_and_authorized`, `partially_available`, `published`, `revised/superseded`, `access_revoked`; only qualified, authorized laboratory actors determine clinical result validity, while Rudra staff can record verified availability and delivery.

**Marketing content**: `draft → submitted → medical_review_if_required → brand_review → approved_version_locked → scheduled → published / publication_failed`; edit after approval creates a new version requiring reapproval.

## F. Fifteen end-to-end workflows with touchpoints

### WF01 — New walk-in patient → order → report
`W003/W005 → R011/R012 → R002/R004 → R009 → B002/B005 → L002/L003 → L005/L006 → L008/L009/L013 → L014 → P005/P009`. Reception verifies identity and current test code; no lab stage is labeled completed without evidence; verified patient receives report notice.

### WF02 — Website booking and home collection
`W003/W005 → W007 → W008 → W009 (if online pay) → W010 → R007/F002 → F001/F003 → F004/F006 → F007/F008/F010 → F011 → L003 → L005/L006 → L013/L014 → P005`. Booking and payer events are idempotent; staff may record an appropriately documented manual payment.

### WF03 — Family member booking and report privacy
`P003 → P004 (authorization check) → W007 → P006/P005 → P009 (separate access check)`. A primary family organizer may manage appointments without automatically seeing adult family medical reports. Revocation blocks previously shared links when technically under Rudra control.

### WF04 — Sample received, rejected and recollected
`F008 → F011 → L003 → L004 reject → L010 → O006 → F002 → F008(new sample)`. Record exact sample and rejection reason; do not erase original. Notify customer with a safe, non-alarming explanation; update promised reporting time only when justified.

### WF05 — Failed or delayed home visit
`F001/F006 → F012 → O006/O007 → R007/P007 → P005/A013`. Due-time thresholds are centre-configurable; failed jobs never appear collected. Customer can ask for human help.

### WF06 — Manual lab status and eventual API migration
`L008 link IDs → L009 record verified source/status → L016/P005 → L012 import review` then `S006/S007` once approved APIs exist. Use mapping, idempotency, provenance and discrepancy review. A verified external notification supersedes neither evidence nor correction history.

### WF07 — Report ingestion, partial results and revised reports
`L013 → L015 (if partial/revised) → L014 → P009 → A013`. Preserve original and replacement versions; revoke superseded links where controlled; do not display report details on unverified communication channels.

### WF08 — Rudra or Metropolis invoice issuance
`R009 → B003 → B002 select approved issuer → B004 → B005/B006 → P010`; for Metropolis-origin document use authorized linking rather than generating a duplicate legal invoice. In both cases show separately the Rudra home collection service charge when applicable.

### WF09 — Refund, cancellation and adjustment
`P007/A007 → B007 → approval via O006 → B006/B015 → P010/A013`. Refunds require source payment verification, reason, authorization and customer communication; cancellations do not silently delete sample history.

### WF10 — Doctor referral and follow-up
`C001/C002/C003 → R013/R009 → C005 → R006/C004`. Only permitted referring-doctor info is shared; no unauthorized medical or patient marketing disclosure; apply ethical referral rules.

### WF11 — Corporate health camp
`W018 → C007/C008 → C009 → R008/R012 → F007/L003 → B012 → C008`. Employee results and consent stay separate from employer-level aggregate operational reporting.

### WF12 — Inbound web/WhatsApp/AI call → lead → booking
`A001/A002/A003 → A004/A005 → R013/R014 → W007/R008 → R010 → P005`. Verify caller before private data; all agent tool calls have source and trace; unsupported info escalates to human.

### WF13 — Social content → campaign → lead attribution
`M003/M004 → M006 → M005/M007/M008 → M017 → R013 → R009 → B005`. Content version approved; ad spend gated by budget/owner; analytics is aggregated, no health-condition audiences from identifiable patient records.

### WF14 — Patient complaint and service recovery
`P013/A004 → A006/A007 → O006/O012 → responsible R/F/L/B screen → customer follow-up → close with resolution evidence`. Every issue has owner, due time, communication log and reopen option.

### WF15 — Staff/centre/day closing & continuity
`O005/F014 → R018 → B009 → L001/L002 → O002/O006 → O016`; reconcile assigned jobs, unhandled samples, cash variance and outage fallback before closing. Offline events sync with duplicate/conflict review.

## G. Required cross-screen behavior and component acceptance

**Global search**: supports order code, patient reference, masked contact, appointment, sample, external Metropolis reference; respects role + centre and rate-limits identity lookups.  
**Every record screen**: audit button, internal notes (where permitted), tasks, communication history, print/export only if authorized, source badges and next recommended action.  
**Every write**: client-side usability validation + authoritative server-side verification; no unsafe success message before transaction commits.  
**Every list**: filtering, sorting, pagination, selection respecting scope, accessibility/keyboard support, responsive layout, no fabricated placeholders as actual data.  
**Every workflow**: back, forward, cancel, retry, help, expired session, offline handling and permission denied case.  
**Patient-facing status**: plain-language confirmed/pending/next steps; never expose unreviewed clinician information or an internal lab stage as a fact.  
**Notification**: event-origin, channel eligibility/consent, template, duplicate suppression, delivery status, actionable failure handling.  
**Multi-centre**: centre-scoped access on every server query, event, export and billing operation; transfer record requires explicit cross-centre authorization.  
**Documents**: encryption, restricted object URLs, malware scanning, upload type/size validation, retention and access audit.  
**Analytics**: data lineage, definitions, counts from actual state not invented, reconciliation against underlying orders/payments, privacy-safe aggregates.

## H. Screen and workflow acceptance test catalogue

The table below sets mandatory demonstrable test scenarios. Each feature must have unit tests, API authorization/integration tests, browser/mobile workflow tests and recovery/negative tests as applicable.

| Test ID | Acceptance scenario | Expected evidence |
|---|---|---|
| ACC-001 | Website test search, filter, detail and package variant | Correct approved catalog/price version with Metropolis mapping |
| ACC-002 | Test catalogue update/expiry | Old booked order retains price snapshot; new price only after approval |
| ACC-003 | Lead creation from website, phone and social | One deduplicated CRM lead and preserved attribution |
| ACC-004 | First-time patient registration | Duplicate check, identity verification, consent, permanent Rudra ID |
| ACC-005 | Family member linking | Separate IDs, adult access consent, revoke works |
| ACC-006 | Cross-patient/cross-centre access attempt | Server denies all unauthorized reads/writes and logs denied attempt |
| ACC-007 | Website booking from enquiry to confirmation | Creates exactly one appointment/order, with payment-independent lifecycle |
| ACC-008 | Manual home-visit fee ₹0/75/99/150/custom | Correct authorized quote, separated fee, explanation and audit |
| ACC-009 | Metropolis catalogue price integrity | No unapproved test markup; active promo eligibility verified |
| ACC-010 | Double submit booking/payment | Idempotent, exactly one business order/payment entry |
| ACC-011 | Staff acceptance/en-route/arrival/collection | Event chronology, staff ID and correct patient-facing projection |
| ACC-012 | Field device offline and sync | No duplicate collection, conflicts reviewed, sensitive cache constrained |
| ACC-013 | Sample scan and branch receipt | Receiver checks identity, custody event correctly attributed |
| ACC-014 | Sample rejection and recollection | Rejection reason recorded, new sample ID and patient-safe update |
| ACC-015 | Unauthorized fabricated lab-processing button | Blocked; verified Metropolis source needed to mark confirmed |
| ACC-016 | Manual partner status with evidence | Clear staff-verified source/time, auditable, not falsely API-confirmed |
| ACC-017 | Optional Metropolis import with duplicate rows | Quarantine/preview/dedupe, no overwrite of authoritative corrections |
| ACC-018 | Lab API status arrives after manual verification | Merge and provenance, no duplicate patient notification |
| ACC-019 | Partial report / revised report | Versioned secure docs, superseded controlled links, notifications |
| ACC-020 | Report access by unrelated patient/marketing agent | Denied and audited |
| ACC-021 | Report link via WhatsApp | Verified recipient, secure expiry/identity verification, consent |
| ACC-022 | Both invoice issuing modes | Legally correct issuer reference, no duplicate tax invoice |
| ACC-023 | Refund with insufficient permission | Approval required, no unapproved fund movement |
| ACC-024 | Daily cash close | UPI/cash/gateway matches or discrepancy case opened |
| ACC-025 | Corporate program employee privacy | Employer sees scoped operational aggregate, not unrelated personal reports |
| ACC-026 | Marketing member with draft-only scope | Can draft, cannot publish/spend/export beyond permission |
| ACC-027 | Publish post after edit to approved draft | New version must be reapproved; stale approval invalid |
| ACC-028 | Ads manager requests more than ceiling | Owner authorization required, event audited |
| ACC-029 | Opted-out patient in outbound AI/WhatsApp campaign | Excluded from send/call; no prohibited contact |
| ACC-030 | Web/WhatsApp/voice AI wrong or uncertain query | Safe fallback and accountable human handoff |
| ACC-031 | AI cannot diagnose, interpret critical results or expose private report | Safety boundary enforced with clinical escalation |
| ACC-032 | Failed external API / no Metropolis access | Rudra booking/CRM/manual workflows remain functional; external status pending |
| ACC-033 | Missed job threshold | Escalation to correct role with time-stamped ownership |
| ACC-034 | Staff shift handover and pending cases | Open jobs remain owned and visible to incoming shift |
| ACC-035 | Backup/restore drill | Verified restoration with access, integrity and event consistency |
| ACC-036 | Critical-result protocol | Qualified clinical escalation, acknowledged evidence, no bot diagnosis |
| ACC-037 | Patient-friendly timeline latency | Actual event updates appropriate projections without manual copying |
| ACC-038 | Communications deduplication | No duplicate SMS/WhatsApp/call for retrying same event |
| ACC-039 | Content metadata rights/patient photos | Publishing requires approved rights and appropriate consent |
| ACC-040 | Release gates | Every screen has UI + API + security + workflow + mobile evidence before Done |

### Definition of Done (for **each** screen ID)

- UI matches accepted desktop/mobile design and meets accessibility basics.
- All visible actionable controls have defined navigation or authorized backend effects; no dummy buttons.
- Server API/domain operation, validation, state transitions, rate-limiting and error flows are documented and tested.
- Role/centre/patient/family permissions verified on both UI and backend.
- Personal/medical data are minimized; session, audit and retention controls verified.
- Real record data and correct loading/empty/error/denied states; no fabricated counts or successes.
- Event, notification and related CRM/order/payment projections stay consistent.
- Manual workflow and retry works where integrations are unavailable; logs record sources honestly.
- Unit/integration/e2e and negative/abuse tests pass; the acceptance owner signs off evidence.
- Screens are marked `planned → designed → in development → tested → accepted → released` only with evidence, not by assumption.

## I. Delivery waves and dependency gates

| Release | Screen groups/features | Gate |
|---|---|---|
| R0 — Foundations | S001–S012, core identity/permissions/data/event/billing-issuer boundaries, secure audit and backup | Threat model, clean DB migrations, permission and restore tests |
| R1 — Usable core | W001–W017, P001–P014, R001–R018, F001–F014, L001–L016, B001–B009, O001/O002/O005/O006 | A real, fully auditable booking→collection→verified status→report with billing and customer timeline |
| R2 — Reliability | L017, F015, B010–B015, O007–O012/O015/O016, R018, S006–S012 improvements | Exceptions, closing, quality, reconciliations, offline recovery |
| R3 — AI/service | A001–A013, P015–P016 | Verified tool safety, consent, unified inbox, human transfer, no diagnostic advice |
| R4 — Marketing | M001–M018, W018–W026 editorial/business pages | Social permissions, review/publish gates, marketing attribution and spend guardrails |
| R5 — Relationships/expansion | C001–C012, O003/O004/O013/O014 | Partner segregation, contracts, company privacy, scaling |
| R6 — Enhancements | Comparability/advanced analytics, multi-provider readiness, optional ABDM if authorized | Specific clinical, privacy, interoperability validations |

**Important:** The release table expresses intended work sequence, not a statement about current repository status. Existing Rudra foundation work must be audited/reused instead of duplicated. R0/R1 features can be delivered incrementally; all needed clinical/privacy controls accompany any feature that handles real data.

## J. Open decisions, kept configurable rather than guessed

- Actual permitted Metropolis data access, copies, report storage, API and export rights — pending franchise/document review.
- Metropolis billing and Rudra billing legal issuer rules, GST/tax handling and intercompany settlement specifics — user will provide later.
- Date/effective rules for confirmed-active TruHealth promotional prices/1+1 offers, and branch-specific availability — confirm/record source approvals.
- Actual service coverage areas, centres, operating hours, staffing schedules, lab turnaround cutoffs — configure once provided.
- Approved laboratory acceptance, urgent/critical results and rejection SOPs — coordinate with qualified Metropolis/Rudra clinical quality responsible persons.
- Real payment gateway, WhatsApp Business provider, India telephony vendor, social publishing connectors — select only with permissions, pricing and requirements review.
- Staff GPS/location, call recording, video consent and marketing data retention — apply proportionate, consented policies.
- Patient family/guardian relationships, legal proof and age restrictions — configure jurisdiction-specific safeguards.

## K. Owner acceptance checklist for the **master specification**

- [ ] Approve screen groups, ID conventions and routes as product baseline.
- [ ] Approve first 5 core journeys (walk-in, home collection, family, sample rejection, billing) as release gates.
- [ ] Verify final brand/franchise wording and data rights with franchise agreement.
- [ ] Supply billing-issuer/settlement details when working on billing module.
- [ ] Confirm branch serviceability and operational handover SOP ownership.
- [ ] Validate marketing publishing authority and approved staff roles.
- [ ] Audit current GitHub code against these screen IDs; mark each implementation status with evidence.

*Prepared as a functional target-state design to avoid repeatedly rebuilding a fragmented website, CRM, staff app, marketing tool or AI system. The IDs, event model and authorization rules are the central contracts; page visual designs can evolve without breaking them.*
