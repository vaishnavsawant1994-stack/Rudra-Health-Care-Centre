export function escalationSourceHref(type: string, id: string, centreId?: string) {
  if (type === "APPOINTMENT") return `/appointments/${encodeURIComponent(id)}`;
  if (type === "LEAD") return `/leads/${encodeURIComponent(id)}`;
  if (type === "COLLECTION_JOB") return `/collections/${encodeURIComponent(id)}`;
  if (type === "SAMPLE_EXCEPTION") return "/samples/exceptions";
  if (type === "REPORT") return `/reports/${encodeURIComponent(id)}`;
  if (type === "REPORT_FOLLOWUP") return `/reports/followups?${new URLSearchParams({ followupId: id, ...(centreId ? { centreId } : {}) })}`;
  if (type === "LEAD_FOLLOWUP") return `/leads/followups?${new URLSearchParams({ followupId: id, ...(centreId ? { centreId } : {}) })}`;
  if (type === "PUBLIC_ENQUIRY") return "/leads/public-enquiries";
  if (type === "CORPORATE_RELATIONSHIP" || type === "PARTNER_RELATIONSHIP") {
    const path = type === "CORPORATE_RELATIONSHIP" ? "/relationships/corporate" : "/relationships/partners";
    return `${path}?${new URLSearchParams({ relationshipId: id, ...(centreId ? { centreId } : {}) })}`;
  }
  if (type === "DOCTOR_RELATIONSHIP") return "/relationships/doctors";
  if (type === "FINANCE_PAYMENT") return `/finance/payments/${encodeURIComponent(id)}`;
  if (type === "FINANCE_REFUND") return "/finance/refunds";
  if (type === "STAFF_TASK") return "/tasks";
  return null;
}
