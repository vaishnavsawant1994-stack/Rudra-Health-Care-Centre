import {beforeEach,describe,expect,it,vi} from "vitest";
const {getApiAccess,getDb}=vi.hoisted(()=>({getApiAccess:vi.fn(),getDb:vi.fn()}));
vi.mock("@/server/access",()=>({getApiAccess}));
vi.mock("@/db/client",()=>({getDb}));
import { GET, POST } from "./route";

describe("reports API access boundary",()=>{
  beforeEach(()=>getApiAccess.mockReset());
  const input={action:"register",centreId:"0ea17e35-92e4-42de-87d4-9de2047bad0e",orderId:"b65f9f2b-1877-4382-b3b0-1b1072ff8246"};
  const request=(origin="http://localhost",key="9f933ce5-1b6a-4c71-b31b-dae504a721ae")=>new Request("http://localhost/api/reports",{method:"POST",headers:{origin,"content-type":"application/json","idempotency-key":key},body:JSON.stringify(input)});
  it("rejects cross-origin writes before authentication",async()=>{expect((await POST(request("https://untrusted.invalid"))).status).toBe(403);expect(getApiAccess).not.toHaveBeenCalled();});
  it("requires idempotency and rejects signed-out or MFA-incomplete staff",async()=>{expect((await POST(request("http://localhost",""))).status).toBe(400);getApiAccess.mockResolvedValueOnce({staff:null,response:Response.json({error:"authentication_required"},{status:401})});expect((await POST(request())).status).toBe(401);getApiAccess.mockResolvedValueOnce({staff:null,response:Response.json({error:"mfa_setup_required"},{status:428})});expect((await POST(request())).status).toBe(428);});
  it("rejects unauthenticated report-list and detail reads",async()=>{getApiAccess.mockResolvedValueOnce({staff:null,response:Response.json({error:"authentication_required"},{status:401})});expect((await GET(new Request("http://localhost/api/reports"))).status).toBe(401);});
  it("marks the authorized report directory private and non-cacheable",async()=>{
    getApiAccess.mockResolvedValueOnce({staff:{organizationId:"org-synthetic",staffUserId:"staff-synthetic",grants:[{key:"reports.read",centreId:null}]},response:null});
    const execute=vi.fn().mockResolvedValue({rows:[]});getDb.mockReturnValue({execute});
    const response=await GET(new Request("http://localhost/api/reports"));
    expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("private, no-store");expect(execute).toHaveBeenCalledTimes(2);
  });
});
