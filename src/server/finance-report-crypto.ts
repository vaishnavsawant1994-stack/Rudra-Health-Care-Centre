import { decryptOperationalData, encryptOperationalData, operationalContext, type OperationalCryptoContext } from "@/server/operational-crypto";

export type FinanceReportRecordType =
  | "finance-payment"
  | "finance-adjustment"
  | "finance-refund"
  | "finance-event"
  | "finance-reconciliation"
  | "report-private"
  | "report-event"
  | "report-delivery"
  | "report-followup"
  | "report-followup-event";

export type FinanceReportContext = Pick<OperationalCryptoContext, "organizationId" | "centreId" | "recordId">;

export function encryptFinanceReportPrivateData<T>(recordType: FinanceReportRecordType, value: T, context: FinanceReportContext) {
  return encryptOperationalData(value, operationalContext(context, recordType));
}

export function decryptFinanceReportPrivateData<T>(recordType: FinanceReportRecordType, envelope: string | null, context: FinanceReportContext): T {
  return decryptOperationalData<T>(envelope, operationalContext(context, recordType));
}
