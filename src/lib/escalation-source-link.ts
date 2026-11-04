export function escalationSourceHref(type: string, id: string, centreId?: string) {
  if (type === "APPOINTMENT") return `/appointments/${encodeURIComponent(id)}`;
  if (type === "LEAD") return `/leads/${encodeURIComponent(id)}`;
  if (type === "COLLECTION_JOB") return `/collections/${encodeURIComponent(id)}`;
  if (type === "SAMPLE_EXCEPTION") return `/samples/exceptions?${new URLSearchParams({ exceptionId: id, ...(centreId ? { centreId } : {}) })}`;
  if (type === "REPORT") return `/reports/${encodeURIComponent(id)}`;
  if (type === "REPORT_FOLLOWUP") return `/reports/followups?${new URLSearchParams({ followupId: id, ...(centreId ? { centreId } : {}) })}`;
  if (type === "LEAD_FOLLOWUP") return `/leads/followups?${new URLSearchParams({ followupId: id, ...(centreId ? { centreId } : {}) })}`;
  if (type === "PUBLIC_ENQUIRY") return `/leads/public-enquiries?${new URLSearchParams({ enquiryId: id, ...(centreId ? { centreId } : {}) })}`;
  if (type === "CORPORATE_RELATIONSHIP") return `/relationships/corporate/${encodeURIComponent(id)}`;
  if (type === "PARTNER_RELATIONSHIP") return `/relationships/partners/${encodeURIComponent(id)}`;
  if (type === "DOCTOR_RELATIONSHIP") return `/relationships/doctors/${encodeURIComponent(id)}`;
  if (type === "FINANCE_PAYMENT") return `/finance/payments/${encodeURIComponent(id)}`;
  if (type === "FINANCE_REFUND") return "/finance/refunds";
  if (type === "STAFF_TASK") return `/tasks?${new URLSearchParams({ taskId: id, ...(centreId ? { centreId } : {}) })}`;
  if (type === "STAFF_ESCALATION") return `/escalations?${new URLSearchParams({ escalationId: id, ...(centreId ? { centreId } : {}) })}`;
  return null;
}
