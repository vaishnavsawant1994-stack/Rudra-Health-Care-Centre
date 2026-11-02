import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { decryptReportDocument, encryptReportDocument } from "@/server/report-crypto";

const MAX_BYTES=10*1024*1024;
function storageRoot(){
  if(process.env.NODE_ENV==="production")throw new Error("private_report_storage_not_qualified");
  const root=path.resolve(/*turbopackIgnore: true*/ process.cwd(),"var","private-reports");
  const publicRoot=path.resolve(/*turbopackIgnore: true*/ process.cwd(),"public")+path.sep;
  if(root===path.resolve(/*turbopackIgnore: true*/ process.cwd(),"public")||root.startsWith(publicRoot))throw new Error("report_storage_must_be_private");
  return root;
}
export function safeReportStorageKey(){return `${randomUUID()}.pdf`;}
export function reportFilePath(key:string){if(!/^[0-9a-f-]{36}\.pdf$/i.test(key))throw new Error("invalid_storage_reference");return path.join(/*turbopackIgnore: true*/ storageRoot(),key);}
export async function persistReportPdf(key:string,bytes:Buffer){
  if(bytes.length<16||bytes.length>MAX_BYTES||!bytes.subarray(0,5).equals(Buffer.from("%PDF-"))||!bytes.subarray(Math.max(0,bytes.length-2048)).includes(Buffer.from("%%EOF")))throw new Error("invalid_pdf");
  const encrypted=encryptReportDocument(bytes,key);const root=storageRoot();await mkdir(root,{recursive:true,mode:0o700});const destination=reportFilePath(key);const handle=await open(/*turbopackIgnore: true*/ destination,"wx",0o600);
  try{await handle.writeFile(encrypted.bytes);await handle.sync();}catch(error){await unlink(/*turbopackIgnore: true*/ destination).catch(()=>undefined);throw error;}finally{await handle.close();}
  return destination;
}
export async function readReportPdf(key:string,expectedKeyId?:string){return decryptReportDocument(await readFile(/*turbopackIgnore: true*/ reportFilePath(key)),key,expectedKeyId);}
export async function removeReportPdf(key:string){await unlink(/*turbopackIgnore: true*/ reportFilePath(key)).catch(()=>undefined);}

export function parseClamAvScanReply(reply: string): "CLEAN" | "REJECTED" | "SCAN_FAILED" | null {
  if (!reply.includes("\0")) return null;
  if (!reply.endsWith("\0")) return "SCAN_FAILED";
  const records = reply.slice(0, -1).split("\0");
  if (records.length !== 1) return "SCAN_FAILED";
  const record = records[0];
  if (record === "stream: OK") return "CLEAN";
  if (/^stream:\s+.+\s+FOUND$/.test(record)) return "REJECTED";
  if (/^stream:\s+.+\s+ERROR$/.test(record)) return "SCAN_FAILED";
  return "SCAN_FAILED";
}

// ClamAV's NUL-framed INSTREAM protocol. Missing/unreachable scanner fails closed to quarantine.
export async function scanReportBuffer(bytes:Buffer):Promise<{status:"CLEAN"|"QUARANTINED"|"SCAN_FAILED"|"REJECTED";engine:string|null}>{
  const host=process.env.REPORT_CLAMAV_HOST;const port=Number(process.env.REPORT_CLAMAV_PORT??3310);
  if(!host||!Number.isInteger(port)||port<1||port>65535)return {status:"QUARANTINED",engine:null};
  // ClamAV TCP has no transport authentication or encryption. Do not send report
  // documents to a remote or ambiguously resolved scanner endpoint.
  if(host!=="localhost"&&host!=="127.0.0.1"&&host!=="::1")return {status:"SCAN_FAILED",engine:null};
  return new Promise(resolve=>{
    const socket=net.createConnection({host,port});let response="";let settled=false;
    const done=(status:"CLEAN"|"QUARANTINED"|"SCAN_FAILED"|"REJECTED")=>{if(settled)return;settled=true;socket.destroy();resolve({status,engine:"ClamAV INSTREAM"});};
    const timer=setTimeout(()=>done("SCAN_FAILED"),5000);
    socket.once("connect",()=>{socket.write(Buffer.from("zINSTREAM\0"));for(let offset=0;offset<bytes.length;offset+=64*1024){const chunk=bytes.subarray(offset,offset+64*1024);const header=Buffer.alloc(4);header.writeUInt32BE(chunk.length);socket.write(header);socket.write(chunk);}socket.write(Buffer.alloc(4));});
    socket.on("data",chunk=>{response+=chunk.toString("utf8");if(response.length>2048){clearTimeout(timer);done("SCAN_FAILED");return;}const result=parseClamAvScanReply(response);if(result){clearTimeout(timer);done(result);}});
    socket.once("error",()=>{clearTimeout(timer);done("SCAN_FAILED");});socket.once("close",()=>{clearTimeout(timer);if(!settled)done("SCAN_FAILED");});
  });
}

export type LocalScannerHealth = "NOT_CONFIGURED" | "AVAILABLE" | "UNAVAILABLE" | "REMOTE_ENDPOINT_BLOCKED";

/** Read-only health probe. It never sends report bytes and only permits loopback endpoints. */
export async function probeLocalClamAv(): Promise<LocalScannerHealth> {
  const host = process.env.REPORT_CLAMAV_HOST;
  const port = Number(process.env.REPORT_CLAMAV_PORT ?? 3310);
  if (!host) return "NOT_CONFIGURED";
  if (!Number.isInteger(port) || port < 1 || port > 65535) return "UNAVAILABLE";
  if (host !== "localhost" && host !== "127.0.0.1" && host !== "::1") return "REMOTE_ENDPOINT_BLOCKED";
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let response = "";
    let settled = false;
    const done = (health: LocalScannerHealth) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(health);
    };
    const timer = setTimeout(() => done("UNAVAILABLE"), 1500);
    socket.once("connect", () => socket.write("zPING\0"));
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
      if (response.length > 32) { done("UNAVAILABLE"); return; }
      if (response.includes("\0")) done(response === "PONG\0" ? "AVAILABLE" : "UNAVAILABLE");
    });
    socket.once("error", () => done("UNAVAILABLE"));
    socket.once("close", () => { if (!settled) done("UNAVAILABLE"); });
  });
}
