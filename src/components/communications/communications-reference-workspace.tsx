"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import styles from "./communications-reference-workspace.module.css";

type PanelSpec = {
  title: string;
  span?: number;
  kind?: "table" | "chat" | "flow" | "list" | "detail" | "bars";
  columns?: string[];
  rows?: string[][];
  bullets?: string[];
  note?: string;
};
type ScreenSpec = {
  code: string;
  title: string;
  subtitle: string;
  stats: [string, string, string][];
  tabs: string[];
  rows: PanelSpec[][];
};

const screens: ScreenSpec[] = [
  {
    code: "A001", title: "Rudra AI Website Chat", subtitle: "Website assistant & enquiry operations · synthetic preview only",
    stats: [["512", "Website chats", "This period"], ["148", "Enquiries / leads", "Synthetic"], ["67", "Booking enquiries", "Illustrative"], ["42", "Home collection", "Illustrative"], ["36", "Human handoffs", "Preview"], ["86%", "AI confidence", "Indicative"], ["3.2 sec", "Avg. response", "Example"]],
    tabs: ["Chat operations", "Knowledge & catalogue", "AI configuration", "Handoff & escalation", "Safety & compliance", "Templates", "Reports", "Audit"],
    rows: [
      [{ title: "Website Chat Inbox · synthetic", span: 3, kind: "list", rows: [["Rahul S. · demo", "Full body checkup", "Open"], ["Priya D. · demo", "Home collection", "In progress"], ["Ajay M. · demo", "Appointment enquiry", "Handoff"], ["Sneha K. · demo", "Test preparation", "Open"], ["Vikram T. · demo", "Report process", "Closed"]] }, { title: "Patient-facing chat preview · not live", span: 6, kind: "chat", rows: [["Rudra Assistant", "Namaste. I can help you find published test and package information."], ["Demo visitor", "I want to explore a health checkup."], ["Rudra Assistant", "I can show approved catalogue information. For medical advice, I will connect you to staff."]] }, { title: "Session & permitted context", span: 3, kind: "detail", bullets: ["Visitor: Demo visitor · not logged in", "Channel: website preview", "Identity: not verified", "Medical record access: unavailable", "Handoff: staff review required"] }],
      [{ title: "Quick actions · preview", span: 4, kind: "list", rows: [["Create FAQ draft", "No publish action"], ["Request human handoff", "Preview only"], ["Review unanswered topic", "Synthetic"]] }, { title: "AI safety & privacy", span: 4, bullets: ["No diagnosis or treatment advice", "Use approved catalogue content only", "Ask for minimum necessary details", "Route clinical questions to staff"] }, { title: "Unanswered topics · examples", span: 4, kind: "table", columns: ["Topic", "Count", "State"], rows: [["Home collection coverage", "7", "Review"], ["Test preparation", "4", "Draft"]] }],
    ],
  },
  {
    code: "A002", title: "WhatsApp Automation & Chatbot Configuration", subtitle: "Phase 08 · configure consent-aware flows, templates and human handoffs for one centre",
    stats: [["Not connected", "WhatsApp status", "Configuration pending"], ["5", "Active automations", "Draft / configuration"], ["12", "Pending handoffs", "Synthetic"], ["6", "Failed messages", "Needs attention"], ["8", "Template approvals", "Illustrative"], ["1,248", "Opt-in contacts", "Demo count"]],
    tabs: ["Flow builder", "All flows (5)", "Triggers", "Responses", "Handoffs", "Language routing"],
    rows: [
      [{ title: "Business connection · sandbox", span: 4, kind: "detail", rows: [["Business number", "+91 90000 12345 · demo"], ["Connection", "Not connected"], ["Provider", "Not configured"], ["Webhook", "Not configured"], ["Centre ownership", "Pune · preview"]] }, { title: "Conversation flow builder · draft", span: 5, kind: "flow", rows: [["Trigger", "Incoming message"], ["Intent", "Test / package enquiry"], ["Language", "English · Hindi · Marathi"], ["Response", "Approved catalogue information"], ["Handoff", "Human support"]] }, { title: "Patient-facing preview · sample", span: 3, kind: "chat", rows: [["Demo visitor", "Which tests are available?"], ["Rudra Assistant", "I can show published tests and packages. This preview is not connected."]] }],
      [{ title: "Approved knowledge sources · examples", span: 4, kind: "table", columns: ["Source", "Version", "State"], rows: [["Diagnostic catalogue", "v2.1", "Example"], ["Rudra service information", "v1.5", "Review"], ["Booking FAQ", "v1.9", "Draft"]] }, { title: "Template management · synthetic", span: 5, kind: "table", columns: ["Template", "Channel", "Language", "State"], rows: [["Booking follow-up", "WhatsApp", "English", "Draft"], ["Home collection reminder", "WhatsApp", "Hindi", "Review"], ["Order status", "WhatsApp", "Marathi", "Draft"]] }, { title: "Consent & safety", span: 3, bullets: ["Opt-in required before messaging", "Quiet hours enforced", "Minimum necessary data", "No automated diagnosis"] }],
      [{ title: "Quick actions", span: 4, kind: "list", rows: [["Create flow", "Preview only"], ["Review template", "No send"], ["Open handoff queue", "Synthetic"]] }, { title: "Configuration history", span: 4, kind: "table", columns: ["Version", "Change", "State"], rows: [["v0.5", "Draft flow", "Preview"], ["v0.4", "Language route", "Example"]] }, { title: "Provider status", span: 4, kind: "detail", bullets: ["Sandbox only", "No live credentials", "No messages sent"] }],
    ],
  },
  {
    code: "A003", title: "AI Voice Calling & Receptionist Configuration", subtitle: "Phase 08 · voice workflows, call scripts, consent and human transfer · synthetic preview",
    stats: [["278", "Call enquiries", "Illustrative"], ["192", "Incoming calls", "Example"], ["86", "Outbound calls", "Not sent"], ["27", "Missed calls", "Synthetic"], ["18", "Callback requests", "Example"], ["11", "Human transfers", "Illustrative"], ["4", "Failed / error", "Example"], ["76%", "AI handling", "Indicative only"]],
    tabs: ["Voice overview", "Telephony & numbers", "AI receptionist", "Call flows & scripts", "Outbound campaigns", "Consent & recording", "Missed calls", "Reports & audit"],
    rows: [
      [{ title: "Telephony integration", span: 4, kind: "detail", rows: [["Provider", "Not configured"], ["Connection", "Not connected"], ["Authorization", "Pending"], ["Recording", "Disabled"]] }, { title: "Business numbers · examples", span: 4, kind: "table", columns: ["Number", "Use", "State"], rows: [["+91 20 4XXX 7821", "Primary · masked", "Pending"], ["+91 20 4XXX 7830", "Callback · masked", "Planned"]] }, { title: "AI receptionist · draft", span: 4, kind: "detail", bullets: ["Greeting: requires approval", "Languages: English · Hindi · Marathi", "Hours: centre-configured", "After hours: enquiry request only"] }],
      [{ title: "Call flow builder · illustrative", span: 5, kind: "flow", rows: [["Incoming call", "Enquiry"], ["AI receptionist", "Greet & identify intent"], ["Route", "Tests · booking · collection"], ["Human support", "When requested / unclear"]] }, { title: "Scripts & knowledge · sample", span: 4, kind: "table", columns: ["Script", "Language", "State"], rows: [["Welcome", "EN / HI / MR", "Draft"], ["Test enquiry", "EN / HI / MR", "Review"], ["Home collection", "EN / HI / MR", "Draft"]] }, { title: "Approved knowledge sources", span: 3, bullets: ["Catalogue · sample only", "Service guide · draft", "FAQs · review required"] }],
      [{ title: "Consent & safety", span: 4, bullets: ["Recording off in preview", "Consent required before recording", "No diagnosis or treatment advice", "Transfer clinical questions to staff"] }, { title: "Missed calls & callback examples", span: 4, kind: "table", columns: ["Type", "Count", "Action"], rows: [["Missed call", "27", "Review"], ["Callback request", "18", "Schedule preview"]] }, { title: "Quick actions", span: 4, kind: "list", rows: [["Test sandbox", "No real call"], ["Edit greeting", "Draft only"], ["Review consent", "Preview"]] }],
    ],
  },
  {
    code: "A004", title: "Omnichannel Inbox & Human Support Console", subtitle: "Centre-scoped conversation layout · synthetic examples, no live channels",
    stats: [["412", "Open conversations", "Example"], ["67", "Unattended chats", "Illustrative"], ["86", "WhatsApp threads", "Not connected"], ["24", "Voice callbacks", "Synthetic"], ["18", "SLA breaches", "Example"], ["22", "Human handoffs", "Preview"], ["14", "Escalations", "Illustrative"], ["36", "Unresolved items", "Example"]],
    tabs: ["All conversations", "Website chat", "WhatsApp", "Voice / callbacks", "Enquiries", "Support tickets", "Leads"],
    rows: [
      [{ title: "Channels & queues", span: 2, kind: "list", rows: [["All conversations", "412"], ["Website chat", "48"], ["WhatsApp", "186"], ["Voice / callbacks", "24"], ["Support tickets", "56"]] }, { title: "Conversation inbox · synthetic", span: 3, kind: "list", rows: [["Demo contact 01", "Home collection", "Pending"], ["Demo contact 02", "Test enquiry", "In progress"], ["Demo contact 03", "Report access question", "Restricted"], ["Demo contact 04", "Appointment enquiry", "Open"]] }, { title: "Selected thread · preview", span: 5, kind: "chat", rows: [["Demo contact", "Can you help me understand the home collection request?"], ["Rudra support", "I can help with general service information. The centre must confirm availability."], ["Internal note", "Synthetic message. No contact or appointment was created."]] }, { title: "Contact & context · limited", span: 2, kind: "detail", bullets: ["Demo lead · unverified", "No clinical record access", "Consent: not recorded", "Centre: preview"] }],
      [{ title: "Queue management", span: 4, kind: "table", columns: ["Queue", "Items", "State"], rows: [["Human handoff", "22", "Example"], ["Missed calls", "18", "Preview"], ["Supervisor review", "14", "Synthetic"]] }, { title: "Agent workload · illustrative", span: 4, kind: "table", columns: ["Role", "Active", "Status"], rows: [["Support agent A", "28", "Demo"], ["Reception queue", "15", "Example"]] }, { title: "Safety & audit", span: 4, bullets: ["Messages are not sent", "Identity checks precede private access", "Every real action requires authorization"] }],
    ],
  },
  {
    code: "A005", title: "Conversation Details & Patient Context", subtitle: "Conversation thread, handoff and permitted contact context · synthetic records",
    stats: [["CON-DEMO-01482", "Conversation ID", "Synthetic"], ["WhatsApp", "Channel", "Disconnected"], ["In progress", "Status", "Example"], ["Medium", "Priority", "Illustrative"], ["30 min", "Response target", "Sample"], ["Demo staff", "Assigned to", "Not a real user"]],
    tabs: ["Conversation & thread", "Contact context", "Appointments", "Orders", "Tasks", "Notes", "Audit history"],
    rows: [
      [{ title: "Conversation context", span: 2, kind: "list", rows: [["Conversation thread", "Selected"], ["Contact context", "Restricted"], ["Linked appointments", "0 demo"], ["Orders", "0 demo"], ["Audit history", "Preview"]] }, { title: "Conversation thread · synthetic", span: 7, kind: "chat", rows: [["Demo visitor", "Hello, I would like to know about the available health checkup packages."], ["Rudra Assistant", "I can share published catalogue information and general service details."], ["Demo visitor", "Can you confirm availability for home collection?"], ["Rudra Support", "The centre would need to verify service availability before confirming."]] }, { title: "Contact & patient context", span: 3, kind: "detail", bullets: ["Demo lead · not verified", "Only enquiry details shown", "Medical records: inaccessible", "Consent: not recorded", "Verify identity before protected access"] }],
      [{ title: "Quick actions · preview only", span: 4, kind: "list", rows: [["Reply / message", "Disabled"], ["Create follow-up task", "Preview"], ["Schedule callback", "No call placed"]] }, { title: "AI & knowledge context", span: 4, bullets: ["Approved source required", "Suggested reply is a draft", "No autonomous clinical answer"] }, { title: "Consent & privacy", span: 4, bullets: ["Communication consent not recorded", "Patient record access restricted", "Human review required"] }],
    ],
  },
  {
    code: "A006", title: "Customer Support Ticket Queue & Case Management", subtitle: "Centre-scoped support operations · all records and metrics below are synthetic",
    stats: [["412", "Open tickets", "Example"], ["67", "Unassigned", "Illustrative"], ["36", "Overdue SLA", "Demo"], ["14", "Escalated", "Preview"], ["58", "Awaiting customer", "Synthetic"], ["94", "Resolved today", "Not actual"]],
    tabs: ["All tickets", "Booking", "Home collection", "Samples", "Reports", "Billing", "Complaints", "Support"],
    rows: [
      [{ title: "Ticket categories", span: 2, kind: "list", rows: [["All tickets", "412"], ["Booking", "86"], ["Home collection", "64"], ["Reports", "52"], ["Billing", "41"]] }, { title: "Ticket registry · synthetic", span: 7, kind: "table", columns: ["Ticket", "Category", "Demo issue", "Priority", "Owner", "State"], rows: [["TKT-DEMO-08421", "Home visit", "Schedule question", "High", "Demo agent", "In progress"], ["TKT-DEMO-08420", "Reports", "Access guidance", "Medium", "Demo agent", "Assigned"], ["TKT-DEMO-08419", "Booking", "Reschedule request", "High", "Unassigned", "Escalated"], ["TKT-DEMO-08418", "Complaint", "Delayed collection", "Medium", "Demo agent", "Pending"], ["TKT-DEMO-08417", "Billing", "Payment question", "Low", "Demo agent", "Open"]] }, { title: "Selected ticket summary", span: 3, kind: "detail", rows: [["Ticket", "TKT-DEMO-08419"], ["Issue", "Reschedule enquiry"], ["Identity", "Not verified"], ["Centre", "Pune · demo"], ["Status", "Illustrative"]] }],
      [{ title: "Queue workload", span: 4, kind: "table", columns: ["Queue", "Items", "State"], rows: [["Unassigned", "67", "Example"], ["Overdue SLA", "36", "Illustrative"], ["Escalations", "14", "Demo"]] }, { title: "Assignment & escalation", span: 4, bullets: ["Assign to authorized support staff", "Supervisor review may be required", "Clinical escalation follows approved policy"] }, { title: "Linked records · access controlled", span: 4, bullets: ["Appointment · demo reference", "Order · restricted preview", "Reports · access denied until verified"] }],
    ],
  },
  {
    code: "A007", title: "Support Ticket Details & Resolution Management", subtitle: "Case investigation, resolution checklist and audit trail · synthetic example only",
    stats: [["TKT-DEMO-00784", "Ticket ID", "Synthetic"], ["Report access", "Category", "Demo"], ["High", "Priority", "Example"], ["In progress", "Status", "Preview"], ["30 min", "Response target", "Illustrative"], ["24 hrs", "Resolution target", "Example"]],
    tabs: ["Case details", "Investigation", "Resolution", "Communication", "Tasks", "Notes", "Audit trail"],
    rows: [
      [{ title: "Customer context · limited", span: 3, kind: "detail", bullets: ["Demo lead · identity unverified", "Contact details masked", "Medical records not shown", "Request: report access guidance"] }, { title: "Issue description & source", span: 5, kind: "detail", bullets: ["Customer asks how report access works.", "Order reference not verified.", "Confirm identity and authorization before any report disclosure.", "This example contains no report or patient record."] }, { title: "SLA & progress", span: 4, kind: "detail", rows: [["Response SLA", "Illustrative · 30 min"], ["Resolution SLA", "Illustrative · 24 hrs"], ["Elapsed", "Example only"], ["Owner", "Demo support agent"]] }],
      [{ title: "Investigation & root cause", span: 5, bullets: ["Verify the order reference through an authorized workflow.", "Check report availability only after identity verification.", "Record evidence using approved access controls."] }, { title: "Assignment & escalation", span: 3, kind: "list", rows: [["Assigned staff", "Demo agent"], ["Department", "Support preview"], ["Escalation", "Not triggered"]] }, { title: "Corrective action checklist", span: 4, kind: "list", rows: [["Confirm request", "Pending"], ["Verify identity", "Required"], ["Review access policy", "Required"], ["Document resolution", "Pending"]] }],
      [{ title: "Case activity timeline", span: 4, kind: "list", rows: [["Ticket created", "Example"], ["Assigned to support", "Preview"], ["Identity check", "Not performed"], ["Resolution", "Pending"]] }, { title: "Communication history", span: 4, kind: "table", columns: ["Channel", "Action", "State"], rows: [["Website", "Enquiry received", "Synthetic"], ["Phone", "Callback", "Not placed"]] }, { title: "Quick actions", span: 4, kind: "list", rows: [["Add note", "Local preview"], ["Request info", "Disabled"], ["Resolve case", "Disabled"]] }],
    ],
  },
  {
    code: "A008", title: "AI Knowledge Library & Source Management", subtitle: "Approved source governance and draft content · sample records only",
    stats: [["186", "Total sources", "Illustrative"], ["28", "Pending review", "Example"], ["112", "Approved articles", "Not published"], ["74", "Channel items", "Synthetic"], ["9", "Expired items", "Example"], ["6", "Unsupported-answer alerts", "Demo"]],
    tabs: ["Source library", "Document uploads", "Article editor", "Approval workflow", "Publishing", "Answer testing", "Knowledge gaps", "Audit"],
    rows: [
      [{ title: "Source library · synthetic", span: 5, kind: "table", columns: ["Source", "Category", "Version", "State"], rows: [["Diagnostic catalogue · sample", "Diagnostics", "v2.1", "Draft"], ["Rudra service guide · sample", "Services", "v1.1", "Review"], ["Booking FAQ · sample", "FAQ", "v1.0", "Draft"], ["Report access guide", "Support", "v0.4", "Unapproved"]] }, { title: "Secure document import", span: 3, kind: "detail", bullets: ["Local preview only", "Upload disabled", "No external source connected", "Validation required"] }, { title: "Selected article · draft", span: 4, kind: "detail", rows: [["Title", "How to book a test? · sample"], ["Category", "Booking"], ["Language", "English"], ["Status", "Draft"], ["Publication", "Disabled"]] }],
      [{ title: "Source approval workflow", span: 4, kind: "flow", rows: [["Draft", "Created"], ["Content review", "Pending"], ["Policy review", "Required"], ["Publish", "Disabled"]] }, { title: "Answer grounding · illustrative", span: 4, kind: "bars", rows: [["Source match", "78%"], ["Policy fit", "88%"], ["Language quality", "84%"]] }, { title: "Knowledge gaps · examples", span: 4, kind: "table", columns: ["Missing topic", "Count", "State"], rows: [["Home collection coverage", "46", "Open"], ["Preparation details", "27", "Review"]] }],
    ],
  },
  {
    code: "A009", title: "AI Conversation Review & Quality Assurance", subtitle: "Human review workspace · illustrative quality scores, not factual evaluation",
    stats: [["128", "Pending reviews", "Synthetic"], ["42", "In review", "Example"], ["18", "Correction needed", "Illustrative"], ["268", "Reviewed items", "Demo"], ["6", "Safety flags", "Example"], ["84%", "Quality trend", "Not measured"]],
    tabs: ["Evaluation queue", "Selected conversation", "Quality scorecard", "Risk review", "Handoff assessment", "Corrections", "Analytics", "Audit"],
    rows: [
      [{ title: "Conversation evaluation queue", span: 4, kind: "table", columns: ["Conversation", "Channel", "Topic", "Safety", "State"], rows: [["CON-DEMO-01482", "Web", "Package enquiry", "—", "Review"], ["CON-DEMO-01483", "WhatsApp", "Home collection", "Flag", "Correction"], ["CON-DEMO-01484", "Voice", "Report status", "—", "Pending"], ["CON-DEMO-01485", "Support", "Preparation", "—", "Pending"]] }, { title: "Selected conversation · synthetic", span: 5, kind: "chat", rows: [["Demo visitor", "Can you share health package information?"], ["Rudra Assistant", "I can explain approved catalogue information. I cannot provide a diagnosis."], ["Demo reviewer", "Review whether the answer stayed within the approved source."]] }, { title: "Quality scorecard · illustrative", span: 3, kind: "bars", rows: [["Relevance", "86%"], ["Accuracy", "80%"], ["Grounding", "78%"], ["Policy", "88%"]] }],
      [{ title: "Risk & quality review", span: 4, bullets: ["No factual quality score is asserted", "Check source grounding", "Check privacy and identity handling", "Route clinical risk to an authorized reviewer"] }, { title: "Human handoff assessment", span: 4, kind: "detail", rows: [["Handoff requested", "Not verified"], ["Staff acceptance", "Not verified"], ["Outcome", "Not recorded"]] }, { title: "Correction workflow", span: 4, kind: "list", rows: [["Assign improvement task", "Preview only"], ["Request knowledge update", "Draft"], ["Mark review complete", "Disabled"]] }],
    ],
  },
  {
    code: "A010", title: "Outbound Communications & Campaign Management", subtitle: "Campaign planning preview · no audience is contacted and no spend occurs",
    stats: [["32", "Campaign examples", "Synthetic"], ["5", "Draft", "Illustrative"], ["3", "Pending approval", "Demo"], ["6", "Scheduled", "Not sent"], ["2", "Active", "Disabled"], ["12", "Completed", "Example"], ["1", "Paused", "Preview"], ["3", "Needs attention", "Synthetic"]],
    tabs: ["Campaigns", "Audience segments", "Message templates", "Voice scripts", "Approvals", "Reports & analytics"],
    rows: [
      [{ title: "Channels & consent status", span: 3, kind: "list", rows: [["WhatsApp", "Not connected"], ["SMS", "Not configured"], ["Email", "Not configured"], ["AI voice", "Disabled"]] }, { title: "Campaign directory · examples", span: 5, kind: "table", columns: ["Campaign", "Channel", "Purpose", "Audience", "State"], rows: [["Home visit reminder", "WhatsApp", "Service", "0 real contacts", "Draft"], ["Report ready notice", "SMS", "Transactional", "0", "Preview"], ["Health package", "Email", "Education", "0", "Review"], ["Appointment reminder", "SMS", "Service", "0", "Draft"]] }, { title: "Selected campaign · draft", span: 4, kind: "detail", rows: [["Purpose", "Service information"], ["Audience", "No real audience"], ["Approval", "Not approved"], ["Delivery", "Disabled"]] }],
      [{ title: "Approval workflow", span: 4, kind: "flow", rows: [["Draft", "Ready for preview"], ["Review", "Pending"], ["Approve", "Disabled"], ["Send", "Disabled"]] }, { title: "Audience & eligibility", span: 4, bullets: ["No real contacts loaded", "Consent eligibility not checked", "Quiet-hours policy required", "No advertising budget connection"] }, { title: "Delivery & response", span: 4, kind: "detail", bullets: ["Provider not connected", "No message queued", "No delivery metric claimed"] }],
    ],
  },
  {
    code: "A011", title: "Call History, Recordings & Dispositions", subtitle: "Call operations design · no provider connection, recordings or actual call events",
    stats: [["486", "Inbound calls", "Synthetic"], ["321", "Outbound calls", "Example"], ["64", "Missed calls", "Illustrative"], ["16", "Failed calls", "Demo"], ["38", "Transferred", "Preview"], ["52", "Callbacks pending", "Synthetic"], ["124", "Recordings for review", "Not available"]],
    tabs: ["All calls", "Inbound", "Outbound", "Missed", "Failed", "Transferred", "Recording review", "Analytics"],
    rows: [
      [{ title: "Call register · synthetic", span: 7, kind: "table", columns: ["Call ref", "Direction", "Masked caller", "Purpose", "Disposition", "State"], rows: [["CALL-DEMO-010287", "Inbound", "+91 98XXX 4527", "Test enquiry", "Callback requested", "Example"], ["CALL-DEMO-010286", "Outbound", "+91 97XXX 8841", "Follow-up", "No answer", "Not placed"], ["CALL-DEMO-010285", "Missed", "+91 90XXX 7710", "Unknown", "Review", "Synthetic"], ["CALL-DEMO-010284", "Transfer", "+91 88XXX 1139", "Support", "Handoff", "Preview"]] }, { title: "Selected call · restricted preview", span: 5, kind: "detail", rows: [["Provider", "Not connected"], ["Recording", "Unavailable"], ["Consent", "Not recorded"], ["Identity", "Unverified demo"], ["Access", "Restricted"]] }],
      [{ title: "Disposition workbench", span: 4, bullets: ["No call can be initiated here", "Recordings are not stored", "Consent must be verified before recording review"] }, { title: "Call analytics · illustrative", span: 4, kind: "bars", rows: [["Enquiry", "42%"], ["Follow-up", "25%"], ["Missed", "9%"], ["Other", "24%"]] }, { title: "Evidence & audit", span: 4, kind: "list", rows: [["Call event", "No verified event"], ["Transcript", "Unavailable"], ["Export", "Disabled"]] }],
    ],
  },
  {
    code: "A012", title: "Missed Calls & Failed Chat Recovery", subtitle: "Recovery queue preview · callbacks, retry and outreach are disabled",
    stats: [["486", "Missed calls", "Illustrative"], ["321", "Abandoned chats", "Synthetic"], ["64", "Failed transfers", "Example"], ["228", "Callbacks pending", "Not scheduled"], ["52", "Overdue recoveries", "Demo"], ["16", "Escalated cases", "Illustrative"]],
    tabs: ["Recovery queue", "Missed calls", "Abandoned chats", "Failed messages", "Failed transfers", "Callback schedule", "Outcomes"],
    rows: [
      [{ title: "Recovery queue · synthetic", span: 6, kind: "table", columns: ["Case", "Channel", "Masked contact", "Reason", "Owner", "State"], rows: [["RC-DEMO-01286", "Call", "+91 98XXX 2145", "Missed call", "Demo agent", "Pending"], ["RC-DEMO-01285", "Chat", "Visitor demo", "Abandoned", "Unassigned", "Review"], ["RC-DEMO-01284", "WhatsApp", "Contact demo", "Delivery failed", "Demo agent", "Retry disabled"], ["RC-DEMO-01283", "Transfer", "Caller demo", "Queue timeout", "Supervisor", "Investigate"]] }, { title: "Selected recovery case", span: 6, kind: "detail", rows: [["Case", "RC-DEMO-01286"], ["Provider reference", "None"], ["Contact", "Masked demo only"], ["Reason", "Missed call"], ["Callback", "Not scheduled"], ["Retry policy", "Disabled in preview"]] }],
      [{ title: "Callback scheduling · preview", span: 4, kind: "detail", bullets: ["No phone number is dialed", "No callback is scheduled", "Consent and identity must be verified"] }, { title: "Safety & escalation routing", span: 4, bullets: ["Quiet hours respected", "Urgent clinical concern → approved human pathway", "No automated medical triage"] }, { title: "Contact attempt history", span: 4, kind: "table", columns: ["Attempt", "Channel", "Result"], rows: [["1", "Call", "Not placed"], ["2", "WhatsApp", "Not sent"], ["3", "Staff review", "Pending"]] }],
    ],
  },
  {
    code: "A013", title: "Notification Templates & Delivery Audit", subtitle: "Template governance preview · delivery states require provider evidence",
    stats: [["56", "Template examples", "Synthetic"], ["8", "Draft", "Illustrative"], ["4", "Under review", "Example"], ["26", "Approved examples", "Not published"], ["18", "Published", "Disabled"], ["3", "Paused", "Demo"], ["1,240", "Queued today", "Not real"], ["46", "Delivery failures", "Illustrative"]],
    tabs: ["Templates", "Delivery audit", "Trigger events", "Approvals", "Failure & retry", "Analytics", "Audit timeline"],
    rows: [
      [{ title: "Template library · synthetic", span: 4, kind: "list", rows: [["Appointment reminder", "SMS · draft"], ["Home collection follow-up", "WhatsApp · review"], ["Report availability notice", "Email · draft"], ["Payment due reminder", "SMS · disabled"]] }, { title: "Selected template · preview", span: 5, kind: "detail", rows: [["Purpose", "Appointment reminder"], ["Channel", "Not connected"], ["Language", "English · sample"], ["Approval", "Not approved"], ["Version", "Draft"]] }, { title: "Template configuration", span: 3, bullets: ["Trigger: not configured", "Consent: required", "Quiet hours: required", "Publish: disabled"] }],
      [{ title: "Message content · sample", span: 4, kind: "chat", rows: [["Draft template", "Hello {{Patient_Name}}, this is a sample appointment reminder from Rudra. Please contact your centre to confirm details."]] }, { title: "Approval workflow", span: 4, kind: "flow", rows: [["Draft", "Sample"], ["Review", "Pending"], ["Approve", "Disabled"], ["Publish", "Disabled"]] }, { title: "Channel & provider status", span: 4, kind: "list", rows: [["WhatsApp", "Not configured"], ["SMS", "Not configured"], ["Email", "Not configured"]] }],
      [{ title: "Delivery audit · no provider events", span: 6, kind: "table", columns: ["Event", "Channel", "Recipient", "Provider evidence", "State"], rows: [["EVT-DEMO-784521", "WhatsApp", "Masked demo", "None", "Not sent"], ["EVT-DEMO-784522", "SMS", "Masked demo", "None", "Not sent"]] }, { title: "Quick actions & policy", span: 6, kind: "list", rows: [["Edit template", "Preview only"], ["Send test", "Disabled"], ["Retry failure", "Disabled"], ["View consent policy", "Reference only"]] }],
    ],
  },
];

const nav = ["Dashboard", "Patients", "Appointments", "Home collection", "Sample receiving", "Lab & dispatch", "Reports", "Payments", "Staff & tasks", "Inventory", "Analytics", "Communications & AI", "Audit & logs", "Settings", "Help & support"];

function Metric({ item }: { item: [string, string, string] }) {
  return <div className={styles.metric}><span className={styles.metricIcon}>◉</span><div><strong>{item[0]}</strong><b>{item[1]}</b><small>{item[2]}</small></div></div>;
}

function Panel({ panel, query, onAction }: { panel: PanelSpec; query: string; onAction: (message: string) => void }) {
  const rows = useMemo(() => (panel.rows ?? []).filter((row) => !query || row.join(" ").toLowerCase().includes(query.toLowerCase())), [panel.rows, query]);
  return <section className={styles.panel} style={{ gridColumn: `span ${panel.span ?? 4}` }}>
    <header className={styles.panelHead}><h2>{panel.title}</h2><button type="button" onClick={() => onAction("Preview only · no live records or external actions are connected.")}>View</button></header>
    {panel.kind === "table" && <div className={styles.tableWrap}><table><thead><tr>{panel.columns?.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={`${panel.title}-${i}`}>{row.map((cell, j) => <td key={`${i}-${j}`}><span className={j === row.length - 1 ? styles.status : undefined}>{cell}</span></td>)}</tr>)}{rows.length === 0 && <tr><td colSpan={panel.columns?.length ?? 1}>No matching synthetic examples.</td></tr>}</tbody></table></div>}
    {panel.kind === "list" && <div className={styles.list}>{rows.map((row, i) => <button type="button" key={`${panel.title}-${i}`} onClick={() => onAction("Selected synthetic preview item.")}><span className={styles.rowIcon}>{i + 1}</span><span><b>{row[0]}</b><small>{row.slice(1, -1).join(" · ")}</small></span><em>{row[row.length - 1]}</em></button>)}{rows.length === 0 && <p>No matching synthetic examples.</p>}</div>}
    {panel.kind === "chat" && <div className={styles.chat}>{rows.map((row, i) => <div className={i % 2 ? styles.chatRight : styles.chatLeft} key={`${panel.title}-${i}`}><b>{row[0]}</b><p>{row.slice(1).join(" · ")}</p><small>Illustrative · not sent</small></div>)}</div>}
    {panel.kind === "flow" && <div className={styles.flow}>{rows.map((row, i) => <div key={`${panel.title}-${i}`}><span>{i + 1}</span><b>{row[0]}</b><small>{row[1]}</small></div>)}</div>}
    {panel.kind === "bars" && <div className={styles.bars}>{rows.map((row, i) => <div key={`${panel.title}-${i}`}><span>{row[0]}</span><i><b style={{ width: `${Number.parseInt(row[1], 10) || (78 - i * 9)}%` }} /></i><strong>{row[1]}</strong></div>)}</div>}
    {panel.kind === "detail" && <div className={styles.detail}>{panel.rows?.map((row) => <div key={row[0]}><b>{row[0]}</b><span>{row[1]}</span></div>)}{panel.bullets?.map((item) => <p key={item}><i>✓</i>{item}</p>)}</div>}
    {!panel.kind && <div className={styles.detail}>{panel.bullets?.map((item) => <p key={item}><i>✓</i>{item}</p>)}</div>}
    {panel.note && <p className={styles.panelNote}>{panel.note}</p>}
  </section>;
}

export function CommunicationsReferenceWorkspace({ screen }: { screen: string }) {
  const spec = screens.find((item) => item.code.toLowerCase() === screen.toLowerCase());
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState(0);
  const [notice, setNotice] = useState("");
  if (!spec) return <div className={styles.notFound}>Unknown Communications screen. Choose A001–A013 from the navigation.</div>;
  return <div className={`rh-comms-reference-root ${styles.workspace}`}>
    <aside className={styles.sidebar}>
      <Link href="/" className={styles.brand}><span>✚</span><b>Rudra Health OS<small>Diagnostics · Care · At Home</small></b></Link>
      <nav aria-label="Rudra workspace">{nav.map((item, i) => <div key={item} className={item === "Communications & AI" ? styles.activeNav : ""}><span>{["⌂", "♙", "▦", "⌂", "▣", "⇄", "▤", "₹", "♧", "▦", "◴", "◉", "◈", "⚙", "?"][i]}</span>{item}</div>)}</nav>
      <div className={styles.online}><i /> Centre Online <small>Synthetic design workspace<br/>No external connections</small><button type="button" onClick={() => setNotice("Sync is unavailable in this local preview.")}>⟳ &nbsp; Preview status</button></div>
    </aside>
    <div className={styles.main}>
      <header className={styles.topbar}><button className={styles.menu} type="button" aria-label="Menu" onClick={() => setNotice("Navigation is shown in the left sidebar.")}>☰</button><label className={styles.centre}>⌖ &nbsp; Pune Centre <small>Rudra Health Care Centre</small>⌄</label><input aria-label="Search synthetic communications examples" placeholder="⌕  Search demo conversations, flows, templates…" value={query} onChange={(event) => setQuery(event.target.value)} /><button type="button" onClick={() => setNotice("No notifications in this synthetic preview.")}>♧ <sup>0</sup></button><div className={styles.user}><span>SP</span><b>Demo Operator<small>Communications · Preview</small></b>⌄</div></header>
      <div className={styles.content}>
        <nav className={styles.screenNav} aria-label="Communications & AI screen designs">{screens.map((item) => <Link aria-current={item.code === spec.code ? "page" : undefined} className={item.code === spec.code ? styles.currentScreen : ""} href={`/communications/design/${item.code.toLowerCase()}`} key={item.code}><b>{item.code}</b><span>{item.title}</span></Link>)}</nav>
        <div className={styles.previewNotice}><b>DESIGN PREVIEW · SYNTHETIC DATA</b><span>Not connected to WhatsApp, telephony, email, patient records or delivery providers. No messages, calls, payments or real workflow changes can be made.</span></div>
        <div className={styles.heading}><div><small>{spec.code} · PHASE 08</small><h1>{spec.title}</h1><p>{spec.subtitle}</p></div><div className={styles.headingActions}><label>Period <select defaultValue="sample"><option value="sample">Sample period</option><option>Last 7 days · illustrative</option></select></label><button type="button" onClick={() => setNotice("Sandbox actions are disabled in this design preview.")}>◉ &nbsp; Test / Sandbox</button><button className={styles.primary} type="button" onClick={() => setNotice("Configuration is not saved. This is a visual design preview.")}>✓ &nbsp; Preview configuration</button></div></div>
        <div className={styles.metrics}>{spec.stats.map((item) => <Metric key={`${spec.code}-${item[1]}`} item={item}/>)}</div>
        <div className={styles.tabs} role="tablist" aria-label={`${spec.code} sections`}>{spec.tabs.map((tab, i) => <button type="button" role="tab" aria-selected={activeTab === i} className={activeTab === i ? styles.selectedTab : ""} onClick={() => { setActiveTab(i); setNotice(`${tab} selected · preview only.`); }} key={tab}>{tab}</button>)}</div>
        {spec.rows.map((row, rowIndex) => <div className={styles.panelGrid} key={`${spec.code}-row-${rowIndex}`}>{row.map((panel) => <Panel key={panel.title} panel={panel} query={query} onAction={setNotice}/>)}</div>)}
        <div className={styles.bottom}><div>Rudra Health OS · Communications & AI · {spec.code}</div><Link href="/communications">Open protected live communications workspace →</Link><span>All names, counts, timestamps and conversations on this screen are synthetic examples.</span></div>
      </div>
    </div>
    {notice && <div className={styles.toast} role="status"><span>{notice}</span><button type="button" onClick={() => setNotice("")}>Dismiss</button></div>}
  </div>;
}
