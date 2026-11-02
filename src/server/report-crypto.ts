import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const MAGIC=Buffer.from("RUDRAR01","ascii");
const IV_BYTES=12;
const TAG_BYTES=16;

function configuredKeys(){
  const raw=process.env.REPORT_DOCUMENT_ENCRYPTION_KEYS;
  if(!raw)throw new Error("report_encryption_key_unavailable");
  let parsed:unknown;
  try{parsed=JSON.parse(raw);}catch{throw new Error("report_encryption_key_invalid");}
  if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))throw new Error("report_encryption_key_invalid");
  const keys=new Map<string,Buffer>();
  for(const [id,value] of Object.entries(parsed)){
    if(!/^[a-zA-Z0-9_-]{1,48}$/.test(id)||typeof value!=="string"||!/^[A-Za-z0-9+/]{43}=$/.test(value))throw new Error("report_encryption_key_invalid");
    const key=Buffer.from(value,"base64");if(key.length!==32)throw new Error("report_encryption_key_invalid");keys.set(id,key);
  }
  if(keys.size===0)throw new Error("report_encryption_key_invalid");
  return keys;
}

export function encryptReportDocument(plaintext:Buffer,storageKey:string){
  if(!/^[0-9a-f-]{36}\.pdf$/i.test(storageKey))throw new Error("invalid_storage_reference");
  const keyId=process.env.REPORT_DOCUMENT_ACTIVE_KEY_ID;
  if(!keyId||!/^[a-zA-Z0-9_-]{1,48}$/.test(keyId))throw new Error("report_encryption_key_unavailable");
  const key=configuredKeys().get(keyId);if(!key)throw new Error("report_encryption_key_unavailable");
  const iv=randomBytes(IV_BYTES);const cipher=createCipheriv("aes-256-gcm",key,iv);
  cipher.setAAD(Buffer.from(`rudra-report-document:v1:${keyId}:${storageKey}`));
  const ciphertext=Buffer.concat([cipher.update(plaintext),cipher.final()]);
  const id=Buffer.from(keyId,"ascii");
  return {keyId,bytes:Buffer.concat([MAGIC,Buffer.from([id.length]),id,iv,cipher.getAuthTag(),ciphertext])};
}

export function decryptReportDocument(envelope:Buffer,storageKey:string,expectedKeyId?:string){
  if(!/^[0-9a-f-]{36}\.pdf$/i.test(storageKey))throw new Error("report_document_integrity_failed");
  if(envelope.length<MAGIC.length+1+1+IV_BYTES+TAG_BYTES||!envelope.subarray(0,MAGIC.length).equals(MAGIC))throw new Error("report_document_integrity_failed");
  const idLength=envelope[MAGIC.length];if(!idLength||idLength>48)throw new Error("report_document_integrity_failed");
  const idStart=MAGIC.length+1;const idEnd=idStart+idLength;
  const keyId=envelope.subarray(idStart,idEnd).toString("ascii");if(!/^[a-zA-Z0-9_-]{1,48}$/.test(keyId))throw new Error("report_document_integrity_failed");
  if(expectedKeyId&&expectedKeyId!==keyId)throw new Error("report_document_integrity_failed");
  const keys=configuredKeys();const key=keys.get(keyId);if(!key)throw new Error("report_encryption_key_unavailable");
  const iv=envelope.subarray(idEnd,idEnd+IV_BYTES);const tag=envelope.subarray(idEnd+IV_BYTES,idEnd+IV_BYTES+TAG_BYTES);const ciphertext=envelope.subarray(idEnd+IV_BYTES+TAG_BYTES);
  try{const decipher=createDecipheriv("aes-256-gcm",key,iv);decipher.setAAD(Buffer.from(`rudra-report-document:v1:${keyId}:${storageKey}`));decipher.setAuthTag(tag);return Buffer.concat([decipher.update(ciphertext),decipher.final()]);}
  catch{throw new Error("report_document_integrity_failed");}
}

export function activeReportKeyId(){const id=process.env.REPORT_DOCUMENT_ACTIVE_KEY_ID;if(!id||!configuredKeys().has(id))throw new Error("report_encryption_key_unavailable");return id;}
