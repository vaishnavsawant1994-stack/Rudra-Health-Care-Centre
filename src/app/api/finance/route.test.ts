import { beforeEach, describe, expect, it, vi } from "vitest";
const {getApiAccess}=vi.hoisted(()=>({getApiAccess:vi.fn()}));
vi.mock("@/server/access",()=>({getApiAccess}));
import { GET, POST } from "./route";

describe("finance API boundary",()=>{
  beforeEach(()=>getApiAccess.mockReset());
  const payload={action:"record_payment",chargeId:"f06a9df7-3568-40f1-8977-ae85c19190c6",amountMinor:100,method:"CASH"};
  const req=(origin="http://localhost",key="6b6806c8-2353-4ac3-851b-21e3a7f9a48a")=>new Request("http://localhost/api/finance",{method:"POST",headers:{origin,"content-type":"application/json","idempotency-key":key},body:JSON.stringify(payload)});
  it("rejects missing idempotency, unauthenticated, and MFA-incomplete financial mutations",async()=>{
    expect((await POST(req("http://localhost",""))).status).toBe(400);
    getApiAccess.mockResolvedValueOnce({staff:null,response:Response.json({error:"authentication_required"},{status:401})});
    expect((await POST(req())).status).toBe(401);
    getApiAccess.mockResolvedValueOnce({staff:null,response:Response.json({error:"mfa_setup_required"},{status:428})});
    expect((await POST(req())).status).toBe(428);
  });
  it("rejects cross-origin financial mutations before authentication or writes",async()=>{
    expect((await POST(req("https://attacker.invalid"))).status).toBe(403);
    expect(getApiAccess).not.toHaveBeenCalled();
  });
  it("rejects unauthenticated financial reads before querying billing records",async()=>{
    getApiAccess.mockResolvedValueOnce({staff:null,response:Response.json({error:"authentication_required"},{status:401})});
    expect((await GET(new Request("http://localhost/api/finance"))).status).toBe(401);
  });
  it("rejects malformed centre filters before issuing financial SQL",async()=>{
    getApiAccess.mockResolvedValueOnce({staff:{organizationId:"org-synthetic",staffUserId:"staff-synthetic",grants:[{key:"finance.read",centreId:null}]},response:null});
    const response=await GET(new Request("http://localhost/api/finance?centreId=not-a-uuid"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({error:"invalid_centre"});
  });
});
