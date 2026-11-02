import {afterEach,describe,expect,it} from "vitest";
import {decryptReportDocument,encryptReportDocument} from "./report-crypto";

const original={keys:process.env.REPORT_DOCUMENT_ENCRYPTION_KEYS,id:process.env.REPORT_DOCUMENT_ACTIVE_KEY_ID};
afterEach(()=>{if(original.keys===undefined)delete process.env.REPORT_DOCUMENT_ENCRYPTION_KEYS;else process.env.REPORT_DOCUMENT_ENCRYPTION_KEYS=original.keys;if(original.id===undefined)delete process.env.REPORT_DOCUMENT_ACTIVE_KEY_ID;else process.env.REPORT_DOCUMENT_ACTIVE_KEY_ID=original.id;});

describe("report document encryption",()=>{
  it("encrypts with AES-GCM and supports decryption during key rotation",()=>{
    const oldKey=Buffer.alloc(32,11).toString("base64");const newKey=Buffer.alloc(32,19).toString("base64");
    process.env.REPORT_DOCUMENT_ACTIVE_KEY_ID="key-old";process.env.REPORT_DOCUMENT_ENCRYPTION_KEYS=JSON.stringify({"key-old":oldKey});
    const plaintext=Buffer.from("synthetic report bytes");const storageKey="00000000-0000-4000-8000-000000000001.pdf";const envelope=encryptReportDocument(plaintext,storageKey).bytes;
    process.env.REPORT_DOCUMENT_ACTIVE_KEY_ID="key-new";process.env.REPORT_DOCUMENT_ENCRYPTION_KEYS=JSON.stringify({"key-old":oldKey,"key-new":newKey});
    expect(decryptReportDocument(envelope,storageKey,"key-old")).toEqual(plaintext);
  });
  it("rejects tampering and missing keys closed",()=>{
    const key=Buffer.alloc(32,31).toString("base64");process.env.REPORT_DOCUMENT_ACTIVE_KEY_ID="test";process.env.REPORT_DOCUMENT_ENCRYPTION_KEYS=JSON.stringify({test:key});
    const storageKey="00000000-0000-4000-8000-000000000002.pdf";const bytes=encryptReportDocument(Buffer.from("synthetic"),storageKey).bytes;bytes[bytes.length-1]^=1;
    expect(()=>decryptReportDocument(bytes,storageKey)).toThrow("report_document_integrity_failed");
    expect(()=>decryptReportDocument(encryptReportDocument(Buffer.from("safe"),storageKey).bytes,"00000000-0000-4000-8000-000000000003.pdf")).toThrow("report_document_integrity_failed");
    delete process.env.REPORT_DOCUMENT_ENCRYPTION_KEYS;expect(()=>encryptReportDocument(Buffer.from("x"),storageKey)).toThrow("report_encryption_key_unavailable");
  });
});
