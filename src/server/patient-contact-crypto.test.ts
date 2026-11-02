import {afterEach,describe,expect,it} from "vitest";
import {blindIndexPatientContact,blindIndexPatientName,decryptPatientContacts,decryptPatientIdentity,encryptPatientContacts,encryptPatientIdentity} from "./patient-contact-crypto";

const previous={keys:process.env.RUDRA_FIELD_ENCRYPTION_KEYS,id:process.env.RUDRA_FIELD_ACTIVE_KEY_ID,index:process.env.RUDRA_BLIND_INDEX_KEY};
afterEach(()=>{if(previous.keys===undefined)delete process.env.RUDRA_FIELD_ENCRYPTION_KEYS;else process.env.RUDRA_FIELD_ENCRYPTION_KEYS=previous.keys;if(previous.id===undefined)delete process.env.RUDRA_FIELD_ACTIVE_KEY_ID;else process.env.RUDRA_FIELD_ACTIVE_KEY_ID=previous.id;if(previous.index===undefined)delete process.env.RUDRA_BLIND_INDEX_KEY;else process.env.RUDRA_BLIND_INDEX_KEY=previous.index;});

describe("patient contact encryption",()=>{
  const context={organizationId:"10000000-0000-4000-8000-000000000001",centreId:"20000000-0000-4000-8000-000000000001",patientId:"30000000-0000-4000-8000-000000000001"};
  it("encrypts contacts with record/field binding and supports retained keys",()=>{
    const oldKey=Buffer.alloc(32,8).toString("base64"),newKey=Buffer.alloc(32,9).toString("base64");process.env.RUDRA_FIELD_ACTIVE_KEY_ID="old";process.env.RUDRA_FIELD_ENCRYPTION_KEYS=JSON.stringify({old:oldKey});process.env.RUDRA_BLIND_INDEX_KEY=Buffer.alloc(32,10).toString("base64");
    const profile={preferredName:"Synthetic",dateOfBirth:"1990-01-01",sexAtRegistration:"UNSPECIFIED" as const,address:{city:"Synthetic City"}};const secret=encryptPatientContacts({phone:"+919876543210",email:"TEST@example.test",profile},context);expect(secret.phoneCiphertext).not.toContain("9876543210");expect(secret.profileCiphertext).not.toContain("1990-01-01");
    process.env.RUDRA_FIELD_ACTIVE_KEY_ID="new";process.env.RUDRA_FIELD_ENCRYPTION_KEYS=JSON.stringify({old:oldKey,new:newKey});expect(decryptPatientContacts(secret,context)).toEqual({phone:"+919876543210",email:"TEST@example.test",profile});
    expect(()=>decryptPatientContacts(secret,{...context,patientId:"30000000-0000-4000-8000-000000000002"})).toThrow("patient_profile_integrity_failed");
  });
  it("provides normalized, purpose-specific keyed exact-match indexes",()=>{
    process.env.RUDRA_BLIND_INDEX_KEY=Buffer.alloc(32,12).toString("base64");
    expect(blindIndexPatientContact("phone","+91 98765 43210")).toBe(blindIndexPatientContact("phone","+919876543210"));
    expect(blindIndexPatientContact("email","TEST@example.test")).toBe(blindIndexPatientContact("email","test@example.test"));
    expect(blindIndexPatientContact("email","test@example.test")).not.toBe(blindIndexPatientContact("phone","test@example.test"));
  });
  it("fails closed on missing or wrong keys and rejects tampering",()=>{
    process.env.RUDRA_FIELD_ACTIVE_KEY_ID="old";process.env.RUDRA_FIELD_ENCRYPTION_KEYS=JSON.stringify({old:Buffer.alloc(32,13).toString("base64")});process.env.RUDRA_BLIND_INDEX_KEY=Buffer.alloc(32,14).toString("base64");
    const secret=encryptPatientContacts({phone:"+919876543210",email:null,profile:{preferredName:null,dateOfBirth:"1990-01-01",sexAtRegistration:null,address:null}},context);const parts=secret.phoneCiphertext.split(".");parts[3]=`${parts[3][0]==="A"?"B":"A"}${parts[3].slice(1)}`;const changed={...secret,phoneCiphertext:parts.join(".")};expect(()=>decryptPatientContacts(changed,context)).toThrow("patient_contact_integrity_failed");
    delete process.env.RUDRA_FIELD_ENCRYPTION_KEYS;expect(()=>encryptPatientContacts({phone:"+919876543210",email:null,profile:{preferredName:null,dateOfBirth:"1990-01-01",sexAtRegistration:null,address:null}},context)).toThrow("patient_encryption_key_unavailable");
  });
  it("encrypts patient names with record/field binding and exact-match indexes",()=>{
    process.env.RUDRA_FIELD_ACTIVE_KEY_ID="names";process.env.RUDRA_FIELD_ENCRYPTION_KEYS=JSON.stringify({names:Buffer.alloc(32,19).toString("base64")});process.env.RUDRA_BLIND_INDEX_KEY=Buffer.alloc(32,20).toString("base64");
    const encrypted=encryptPatientIdentity({firstName:"Synthetic",lastName:"Person"},context);
    expect(encrypted.nameCiphertext).not.toContain("Synthetic");
    expect(decryptPatientIdentity({encryptionKeyId:"names",nameCiphertext:encrypted.nameCiphertext},context)).toEqual({firstName:"Synthetic",lastName:"Person"});
    expect(blindIndexPatientName("full","Synthetic Person")).toBe(encrypted.fullNameBlindIndex);
    expect(blindIndexPatientName("full"," synthetic   person ")).toBe(encrypted.fullNameBlindIndex);
    expect(()=>decryptPatientIdentity({encryptionKeyId:"names",nameCiphertext:encrypted.nameCiphertext},{...context,patientId:"30000000-0000-4000-8000-000000000002"})).toThrow("patient_name_integrity_failed");
    const parts=encrypted.nameCiphertext.split(".");parts[3]=`${parts[3][0]==="A"?"B":"A"}${parts[3].slice(1)}`;
    expect(()=>decryptPatientIdentity({encryptionKeyId:"names",nameCiphertext:parts.join(".")},context)).toThrow("patient_name_integrity_failed");
    expect(blindIndexPatientName("first","Synthetic")).not.toBe(blindIndexPatientName("last","Synthetic"));
  });
});
