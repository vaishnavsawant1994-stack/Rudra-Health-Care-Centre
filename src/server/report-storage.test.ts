import {afterAll,beforeAll,describe,expect,it} from "vitest";
import {readFile} from "node:fs/promises";
import net from "node:net";
import {parseClamAvScanReply,persistReportPdf,readReportPdf,removeReportPdf,safeReportStorageKey,scanReportBuffer,reportFilePath,probeLocalClamAv} from "./report-storage";

describe("private report storage",()=>{
  const prior={keys:process.env.REPORT_DOCUMENT_ENCRYPTION_KEYS,id:process.env.REPORT_DOCUMENT_ACTIVE_KEY_ID,scannerHost:process.env.REPORT_CLAMAV_HOST,scannerPort:process.env.REPORT_CLAMAV_PORT};
  beforeAll(()=>{process.env.REPORT_DOCUMENT_ACTIVE_KEY_ID="test-key";process.env.REPORT_DOCUMENT_ENCRYPTION_KEYS=JSON.stringify({"test-key":Buffer.alloc(32,7).toString("base64")});});
  afterAll(()=>{if(prior.keys===undefined)delete process.env.REPORT_DOCUMENT_ENCRYPTION_KEYS;else process.env.REPORT_DOCUMENT_ENCRYPTION_KEYS=prior.keys;if(prior.id===undefined)delete process.env.REPORT_DOCUMENT_ACTIVE_KEY_ID;else process.env.REPORT_DOCUMENT_ACTIVE_KEY_ID=prior.id;if(prior.scannerHost===undefined)delete process.env.REPORT_CLAMAV_HOST;else process.env.REPORT_CLAMAV_HOST=prior.scannerHost;if(prior.scannerPort===undefined)delete process.env.REPORT_CLAMAV_PORT;else process.env.REPORT_CLAMAV_PORT=prior.scannerPort;});
  it("accepts a bounded PDF and stores only authenticated ciphertext under an opaque key",async()=>{const bytes=Buffer.from("%PDF-1.7\nsynthetic report content\n%%EOF\n");const key=safeReportStorageKey();await persistReportPdf(key,bytes);const stored=await readFile(reportFilePath(key));expect(stored.subarray(0,5).toString()).not.toBe("%PDF-");expect(await readReportPdf(key)).toEqual(bytes);await removeReportPdf(key);});
  it("rejects non-PDF content and fails closed to quarantine without a scanner",async()=>{await expect(persistReportPdf(safeReportStorageKey(),Buffer.from("not a pdf"))).rejects.toThrow("invalid_pdf");delete process.env.REPORT_CLAMAV_HOST;delete process.env.REPORT_CLAMAV_PORT;expect(await scanReportBuffer(Buffer.from("synthetic"))).toEqual({status:"QUARANTINED",engine:null});});
  it("accepts only one complete NUL-framed clean scan record",()=>{
    expect(parseClamAvScanReply("stream: OK")).toBeNull();
    expect(parseClamAvScanReply("stream: OK\0")).toBe("CLEAN");
    expect(parseClamAvScanReply(" stream: OK\0")).toBe("SCAN_FAILED");
    expect(parseClamAvScanReply("stream: Test-Signature FOUND\0")).toBe("REJECTED");
    expect(parseClamAvScanReply("stream: Scanner returned OK ERROR\0")).toBe("SCAN_FAILED");
    expect(parseClamAvScanReply("garbage OK\0")).toBe("SCAN_FAILED");
    expect(parseClamAvScanReply("stream: OK\0extra\0")).toBe("SCAN_FAILED");
    expect(parseClamAvScanReply("stream: OK\0truncated")).toBe("SCAN_FAILED");
  });
  it("refuses unencrypted remote scanner connections",async()=>{
    process.env.REPORT_CLAMAV_PORT="3310";
    for(const host of ["scanner.example.invalid","203.0.113.8","10.0.0.4"]){process.env.REPORT_CLAMAV_HOST=host;expect(await scanReportBuffer(Buffer.from("synthetic"))).toEqual({status:"SCAN_FAILED",engine:null});}
  });
  it.each([
    ["clean", "stream: OK\0", "CLEAN"],
    ["detected", "stream: Synthetic-Test-Signature FOUND\0", "REJECTED"],
    ["malformed", "untrusted response\0", "SCAN_FAILED"],
  ] as const)("uses the local INSTREAM protocol and maps a %s response fail-closed", async (_label, reply, expected) => {
    const payload = Buffer.from("synthetic quarantined bytes");
    const server = net.createServer((socket) => {
      let request = Buffer.alloc(0);
      socket.on("data", (chunk) => {
        request = Buffer.concat([request, chunk]);
        if (!request.subarray(0, 10).equals(Buffer.from("zINSTREAM\0"))) return;
        let offset = 10;
        while (request.length >= offset + 4) {
          const size = request.readUInt32BE(offset);
          offset += 4;
          if (size === 0) {
            const framed = request.subarray(offset - payload.length - 4, offset - 4);
            expect(framed).toEqual(payload);
            socket.end(reply);
            return;
          }
          if (request.length < offset + size) return;
          offset += size;
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("synthetic_scanner_listener_failed");
    process.env.REPORT_CLAMAV_HOST = "127.0.0.1";
    process.env.REPORT_CLAMAV_PORT = String(address.port);
    try {
      expect(await scanReportBuffer(payload)).toEqual({ status: expected, engine: "ClamAV INSTREAM" });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
  it("reports an unconfigured or remote scanner without contacting it", async () => {
    delete process.env.REPORT_CLAMAV_HOST;
    expect(await probeLocalClamAv()).toBe("NOT_CONFIGURED");
    process.env.REPORT_CLAMAV_HOST = "scanner.example.invalid";
    process.env.REPORT_CLAMAV_PORT = "3310";
    expect(await probeLocalClamAv()).toBe("REMOTE_ENDPOINT_BLOCKED");
  });
  it.each([["PONG\0", "AVAILABLE"], ["unexpected\0", "UNAVAILABLE"]] as const)("probes local scanner health from the PING/PONG protocol", async (reply, expected) => {
    const server = net.createServer((socket) => socket.once("data", (data) => {
      expect(data).toEqual(Buffer.from("zPING\0"));
      socket.end(reply);
    }));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("synthetic_scanner_listener_failed");
    process.env.REPORT_CLAMAV_HOST = "127.0.0.1";
    process.env.REPORT_CLAMAV_PORT = String(address.port);
    try { expect(await probeLocalClamAv()).toBe(expected); }
    finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
  });
});
