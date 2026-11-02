import { AdminShell } from "@/components/admin/admin-shell";
import { FinanceWorkbench } from "@/components/finance/finance-workbench";
export default function PoliciesPage(){return <AdminShell permission="finance.read" title="Billing responsibility">{(staff)=><FinanceWorkbench mode="policies" grants={staff.grants}/>}</AdminShell>;}
