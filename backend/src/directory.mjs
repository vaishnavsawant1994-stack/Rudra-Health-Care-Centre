import { assertCentre, assertPermission, hasPermission, HttpError, parsePage, permissionCentres } from './authorization.mjs';
import { decryptField, encryptField, hmacLookup, maskMobile, normalizeMobile } from './security.mjs';

const optionalText = (value, field, max) => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.trim().length > max) throw new HttpError(400, 'INVALID_FIELD', `${field} must be ${max} characters or fewer.`);
  return value.trim() || null;
};

const requiredText = (value, field, max) => {
  const result = optionalText(value, field, max);
  if (!result) throw new HttpError(400, 'INVALID_FIELD', `${field} is required.`);
  return result;
};

function mobileValues(value, prefix = '') {
  const normalized = normalizeMobile(value);
  if (!/^\+?[0-9]{7,15}$/.test(normalized)) throw new HttpError(400, 'INVALID_MOBILE', 'Enter a valid mobile number.');
  return [
    [`${prefix}mobile_ciphertext`, encryptField(normalized)],
    [`${prefix}mobile_lookup_hash`, hmacLookup(normalized)],
    [`${prefix}mobile_mask`, maskMobile(normalized)]
  ];
}

function emailValue(value, column) {
  if (value === null || value === undefined || value === '') return [[column, null]];
  const normalized = String(value).trim().toLowerCase();
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new HttpError(400, 'INVALID_EMAIL', 'Enter a valid email address.');
  return [[column, encryptField(normalized)]];
}

const textField = (column, label, max, required = false) => ({
  required,
  parse: (value) => [[column, required ? requiredText(value, label, max) : optionalText(value, label, max)]]
});
const statusField = (allowed, fallback = 'ACTIVE') => ({
  defaultValue: fallback,
  parse(value) {
    const status = String(value || '').toUpperCase();
    if (!allowed.includes(status)) throw new HttpError(400, 'INVALID_STATUS', 'Select a supported status.');
    return [['status', status]];
  }
});
const contactFields = (prefix = '') => ({
  mobile: { parse: (value) => value === null || value === undefined || value === '' ? [[`${prefix}mobile_ciphertext`, null], [`${prefix}mobile_lookup_hash`, null], [`${prefix}mobile_mask`, null]] : mobileValues(value, prefix) },
  email: { parse: (value) => emailValue(value, `${prefix}email_ciphertext`) }
});

const definitions = {
  doctors: {
    table: 'doctors', kind: 'DOCTOR', prefix: 'DOC', noun: 'doctor', publicKey: 'doctorId',
    read: 'doctors.read', create: 'doctors.create', update: 'doctors.update', statuses:['ACTIVE','INACTIVE'], orderBy:'first_name',
    contactRead: 'doctors.contact.read', credentialRead: 'doctors.credentials.read',
    search: ['first_name','last_name','specialty','qualification','public_id'],
    fields: {
      firstName: textField('first_name','First name',120,true), lastName: textField('last_name','Last name',120),
      specialty: textField('specialty','Specialty',120), qualification: textField('qualification','Qualification',240),
      registrationNumber: { parse(value) {
        const number = optionalText(value,'Registration number',80);
        if (!number) return [['registration_ciphertext',null],['registration_lookup_hash',null],['registration_mask',null]];
        const normalized = number.toUpperCase();
        return [['registration_ciphertext',encryptField(normalized)],['registration_lookup_hash',hmacLookup(normalized)],['registration_mask',`••••${normalized.slice(-4)}`]];
      } },
      ...contactFields(), status: statusField(['ACTIVE','INACTIVE']), notes: textField('notes','Notes',4000)
    },
    summary: ['first_name','last_name','specialty','qualification','registration_mask','mobile_mask','email_ciphertext','mobile_ciphertext']
  },
  corporates: {
    table: 'corporates', kind: 'CORPORATE', prefix: 'COR', noun: 'corporate', publicKey: 'corporateId',
    read: 'corporates.read', create: 'corporates.create', update: 'corporates.update', contactRead: 'corporates.contact.read', statuses:['ACTIVE','PAUSED','CLOSED'], orderBy:'name',
    search: ['name','industry','contact_name','public_id'],
    fields: {
      name: textField('name','Name',180,true), industry: textField('industry','Industry',120),
      contactName: textField('contact_name','Contact name',180), contactTitle: textField('contact_title','Contact title',120),
      ...contactFields('contact_'), billingTerms: textField('billing_terms','Billing terms',1000),
      status: statusField(['ACTIVE','PAUSED','CLOSED']), notes: textField('notes','Notes',4000)
    },
    summary: ['name','industry','contact_name','contact_title','contact_mobile_mask','contact_mobile_ciphertext','contact_email_ciphertext']
  },
  partners: {
    table: 'partners', kind: 'PARTNER', prefix: 'PAR', noun: 'partner', publicKey: 'partnerId',
    read: 'partners.read', create: 'partners.create', update: 'partners.update', contactRead: 'partners.contact.read', statuses:['ACTIVE','INACTIVE'], orderBy:'name',
    search: ['name','partner_type','contact_name','public_id'],
    fields: {
      partnerType: { parse(value) {
        const type = String(value || '').toUpperCase();
        if (!['REFERRAL','COLLECTION','COMMUNITY','CORPORATE','OTHER'].includes(type)) throw new HttpError(400,'INVALID_PARTNER_TYPE','Select a supported partner type.');
        return [['partner_type',type]];
      } },
      name: textField('name','Name',180,true), contactName: textField('contact_name','Contact name',180),
      ...contactFields('contact_'), notes: textField('notes','Notes',4000), status: statusField(['ACTIVE','INACTIVE'])
    },
    summary: ['partner_type','name','contact_name','contact_mobile_mask','contact_mobile_ciphertext','contact_email_ciphertext']
  },
  tests: {
    table: 'catalogue_tests', kind: 'CATALOGUE_TEST', prefix: 'TST', noun: 'test', publicKey: 'testId',
    read: 'catalogue.tests.read', create: 'catalogue.tests.create', update: 'catalogue.tests.update', statuses:['ACTIVE','INACTIVE'], orderBy:'name',
    search: ['code','name','category','specimen_type','public_id'],
    fields: {
      code: textField('code','Code',40,true), name: textField('name','Name',180,true), category: textField('category','Category',120),
      specimenType: textField('specimen_type','Specimen type',120),
      fastingRequired: { parse(value) { if (typeof value !== 'boolean') throw new HttpError(400,'INVALID_FIELD','Fasting required must be true or false.'); return [['fasting_required',value]]; } },
      preparationInstructions: textField('preparation_instructions','Preparation instructions',4000),
      turnaroundHours: { parse(value) { if (value === null || value === undefined || value === '') return [['turnaround_hours',null]]; const number=Number(value); if(!Number.isInteger(number)||number<0||number>8760) throw new HttpError(400,'INVALID_FIELD','Turnaround hours must be a whole number between 0 and 8760.'); return [['turnaround_hours',number]]; } },
      priceMinor: { parse(value) { if (value === null || value === undefined || value === '') return [['price_minor',null]]; const number=Number(value); if(!Number.isSafeInteger(number)||number<0) throw new HttpError(400,'INVALID_FIELD','Price must be a non-negative whole number in minor currency units.'); return [['price_minor',number]]; } },
      currency: { defaultValue: 'INR', parse(value) { const currency=String(value||'').toUpperCase(); if(!/^[A-Z]{3}$/.test(currency)) throw new HttpError(400,'INVALID_FIELD','Currency must be a three-letter code.'); return [['currency',currency]]; } },
      status: statusField(['ACTIVE','INACTIVE'])
    },
    summary: ['code','name','category','specimen_type','fasting_required','turnaround_hours','price_minor','currency']
  },
  packages: {
    table: 'catalogue_packages', kind: 'CATALOGUE_PACKAGE', prefix: 'PKG', noun: 'package', publicKey: 'packageId',
    read: 'catalogue.packages.read', create: 'catalogue.packages.create', update: 'catalogue.packages.update', statuses:['ACTIVE','INACTIVE'], orderBy:'name',
    search: ['code','name','category','public_id'],
    fields: {
      code: textField('code','Code',40,true), name: textField('name','Name',180,true), category: textField('category','Category',120),
      description: textField('description','Description',4000),
      priceMinor: { parse(value) { if (value === null || value === undefined || value === '') return [['price_minor',null]]; const number=Number(value); if(!Number.isSafeInteger(number)||number<0) throw new HttpError(400,'INVALID_FIELD','Price must be a non-negative whole number in minor currency units.'); return [['price_minor',number]]; } },
      currency: { defaultValue: 'INR', parse(value) { const currency=String(value||'').toUpperCase(); if(!/^[A-Z]{3}$/.test(currency)) throw new HttpError(400,'INVALID_FIELD','Currency must be a three-letter code.'); return [['currency',currency]]; } },
      status: statusField(['ACTIVE','INACTIVE'])
    },
    summary: ['code','name','category','price_minor','currency'], hasItems: true
  }
};

async function nextPublicId(client, principal, definition) {
  const result = await client.query(
    `INSERT INTO identifier_sequences (organization_id, identifier_kind, period_key, next_value)
     VALUES ($1,$2,'',2) ON CONFLICT (organization_id,identifier_kind,period_key)
     DO UPDATE SET next_value=identifier_sequences.next_value+1 RETURNING next_value-1 AS allocated`,
    [principal.organizationId, definition.kind]
  );
  return `RHC-${definition.prefix}-${String(result.rows[0].allocated).padStart(6,'0')}`;
}

async function inTransaction(pool, callback) {
  const client=await pool.connect();
  try { await client.query('BEGIN'); const value=await callback(client); await client.query('COMMIT'); return value; }
  catch(error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function audit(client, principal, definition, row, action, request) {
  await client.query(
    `INSERT INTO audit_events (organization_id,actor_user_id,actor_type,action,entity_type,entity_id,centre_id,after_json,ip_address,user_agent,request_id,outcome)
     VALUES ($1,$2,'USER',$3,$4,$5,$6,$7::jsonb,$8,$9,$10,'SUCCESS')`,
    [principal.organizationId,principal.id,action,definition.noun.toUpperCase(),row.id,row.centre_id,
     JSON.stringify({publicId:row.public_id,centreId:row.centre_id,status:row.status,version:row.version}),
     request.socket.remoteAddress?.replace(/^::ffff:/,'' )||null,request.headers['user-agent']||null,request.requestId]
  );
}

function fieldValues(definition, body, partial) {
  const values=[];
  for(const [key,field] of Object.entries(definition.fields)) {
    if(Object.hasOwn(body,key)) values.push(...field.parse(body[key]));
    else if(!partial && Object.hasOwn(field,'defaultValue')) values.push(...field.parse(field.defaultValue));
  }
  if(!partial) {
    for(const [key,field] of Object.entries(definition.fields)) {
      if(field.required && !Object.hasOwn(body,key)) throw new HttpError(400,'INVALID_FIELD',`${key} is required.`);
    }
  }
  return values;
}

function publicRecord(definition,row,principal) {
  const result={id:row.id,[definition.publicKey]:row.public_id,centreId:row.centre_id,status:row.status,createdAt:row.created_at,updatedAt:row.updated_at,version:row.version};
  for(const column of definition.summary) {
    const key=column.replace(/_([a-z])/g,(_,letter)=>letter.toUpperCase());
    if(column.endsWith('_ciphertext')) {
      const base=column.replace('_ciphertext','');
      const permission=definition.contactRead;
      const maskColumn=`${base}_mask`;
      const target=base==='email'?'email':base.endsWith('email')?'contactEmail':base==='mobile'?'mobile':'contactMobile';
      result[target]=permission&&hasPermission(principal,permission,row.centre_id)?decryptField(row[column]):row[maskColumn]||null;
    } else if(column==='registration_mask') {
      result.registrationNumber=hasPermission(principal,definition.credentialRead,row.centre_id)?decryptField(row.registration_ciphertext):row.registration_mask;
    } else result[key]=row[column];
  }
  return result;
}

function scopedCentres(principal,permission) {
  const centres=permissionCentres(principal,permission);
  if(centres===null) return null;
  if(!centres.length) throw new HttpError(403,'PERMISSION_DENIED','You do not have permission to access this directory.');
  return centres;
}

export async function listDirectory(pool,principal,url,kind) {
  const definition=definitions[kind];
  assertPermission(principal,definition.read);
  const {limit,offset}=parsePage(url);
  const requestedCentre=url.searchParams.get('centreId');
  const centres=scopedCentres(principal,definition.read);
  if(requestedCentre) { assertCentre(principal,requestedCentre); assertPermission(principal,definition.read,requestedCentre); }
  const query=(url.searchParams.get('q')||'').trim();
  if(query.length>120) throw new HttpError(400,'SEARCH_TOO_LONG','Search must be 120 characters or fewer.');
  const status=url.searchParams.get('status');
  if(status&&!definition.statuses.includes(status)) throw new HttpError(400,'INVALID_STATUS','Select a supported status.');
  const params=[principal.organizationId,requestedCentre||null,status||null,query];
  let where='organization_id=$1 AND ($2::uuid IS NULL OR centre_id=$2) AND ($3::text IS NULL OR status=$3) AND ($4=\'\' OR lower(concat_ws(\' \','+definition.search.join(',')+')) LIKE \'%\'||lower($4)||\'%\')';
  if(!requestedCentre&&centres!==null) { params.push(centres); where+=' AND centre_id=ANY($5::uuid[])'; }
  params.push(limit,offset);
  const limitBind=params.length-1,offsetBind=params.length;
  const rows=await pool.query(`SELECT * FROM ${definition.table} WHERE ${where} ORDER BY lower(${definition.orderBy}),created_at DESC LIMIT $${limitBind} OFFSET $${offsetBind}`,params);
  return {data:rows.rows.map(row=>publicRecord(definition,row,principal)),meta:{limit,offset}};
}

async function findRecord(client,principal,definition,id,permission,lock=false) {
  const centres=scopedCentres(principal,permission);
  const params=[principal.organizationId,id];
  let scope='';
  if(centres!==null) { params.push(centres); scope=` AND centre_id=ANY($${params.length}::uuid[])`; }
  const result=await client.query(`SELECT * FROM ${definition.table} WHERE organization_id=$1 AND (id::text=$2 OR public_id=$2)${scope}${lock?' FOR UPDATE':''}`,params);
  const row=result.rows[0];
  if(!row) throw new HttpError(404,`${definition.noun.toUpperCase()}_NOT_FOUND`,`${definition.noun} was not found.`);
  assertCentre(principal,row.centre_id);assertPermission(principal,permission,row.centre_id);
  return row;
}

async function packageItems(client,principal,row) {
  const result=await client.query(`SELECT t.public_id AS test_id,t.name,t.code,i.quantity,i.display_order
    FROM catalogue_package_items i JOIN catalogue_tests t ON t.organization_id=i.organization_id AND t.id=i.test_id AND t.centre_id=i.centre_id
    WHERE i.organization_id=$1 AND i.package_id=$2 ORDER BY i.display_order,t.name`,[principal.organizationId,row.id]);
  return result.rows.map(item=>({testId:item.test_id,name:item.name,code:item.code,quantity:item.quantity,displayOrder:item.display_order}));
}

async function publicFull(client,definition,row,principal) {
  const result=publicRecord(definition,row,principal);
  if(definition.hasItems) result.items=await packageItems(client,principal,row);
  return result;
}

async function setPackageItems(client,principal,centreId,packageId,items) {
  if(!Array.isArray(items)||items.length<1||items.length>100) throw new HttpError(400,'INVALID_PACKAGE_ITEMS','A package must contain between 1 and 100 test items.');
  const seen=new Set();
  for(let index=0;index<items.length;index++) {
    const item=items[index];
    if(!item||typeof item.testId!=='string') throw new HttpError(400,'INVALID_PACKAGE_ITEMS','Each package item must reference a test.');
    const quantity=Number(item.quantity??1);
    if(!Number.isInteger(quantity)||quantity<1||quantity>100) throw new HttpError(400,'INVALID_PACKAGE_ITEMS','Each item quantity must be a whole number from 1 to 100.');
    const found=await client.query(`SELECT id FROM catalogue_tests WHERE organization_id=$1 AND centre_id=$2 AND (id::text=$3 OR public_id=$3)`,[principal.organizationId,centreId,item.testId]);
    if(!found.rowCount) throw new HttpError(400,'INVALID_PACKAGE_ITEMS','Every package test must belong to the same organization and centre.');
    const testId=found.rows[0].id;
    if(seen.has(testId)) throw new HttpError(400,'INVALID_PACKAGE_ITEMS','A test may appear only once in a package.');
    seen.add(testId);
    await client.query(`INSERT INTO catalogue_package_items (organization_id,centre_id,package_id,test_id,quantity,display_order)
      VALUES ($1,$2,$3,$4,$5,$6)`,[principal.organizationId,centreId,packageId,testId,quantity,index]);
  }
}

export async function getDirectoryRecord(pool,principal,id,kind) {
  const definition=definitions[kind];assertPermission(principal,definition.read);
  const client=await pool.connect();
  try { const row=await findRecord(client,principal,definition,id,definition.read); return {data:await publicFull(client,definition,row,principal)}; }
  finally { client.release(); }
}

export async function createDirectoryRecord(pool,principal,body,request,kind) {
  const definition=definitions[kind];assertPermission(principal,definition.create);
  const centreId=body.centreId||principal.primaryCentreId;
  if(!centreId) throw new HttpError(400,'CENTRE_REQUIRED','Select an assigned centre before creating this record.');
  assertCentre(principal,centreId);assertPermission(principal,definition.create,centreId);
  const fields=fieldValues(definition,body,false);
  if(definition.hasItems&&!Array.isArray(body.items)) throw new HttpError(400,'INVALID_PACKAGE_ITEMS','A package requires a list of test items.');
  return inTransaction(pool,async(client)=>{
    const publicId=await nextPublicId(client,principal,definition);
    const entries=[['organization_id',principal.organizationId],['public_id',publicId],['centre_id',centreId],...fields,['created_by',principal.id]];
    const columns=entries.map(([column])=>column).join(',');
    const placeholders=entries.map((_,index)=>`$${index+1}`).join(',');
    const inserted=await client.query(`INSERT INTO ${definition.table} (${columns}) VALUES (${placeholders}) RETURNING *`,entries.map(([,value])=>value));
    const row=inserted.rows[0];
    if(definition.hasItems) await setPackageItems(client,principal,centreId,row.id,body.items);
    await audit(client,principal,definition,row,`${definition.noun}.created`,request);
    return {data:await publicFull(client,definition,row,principal)};
  });
}

export async function updateDirectoryRecord(pool,principal,id,body,request,kind) {
  const definition=definitions[kind];assertPermission(principal,definition.update);
  const fields=fieldValues(definition,body,true);
  const wantsItems=definition.hasItems&&Object.hasOwn(body,'items');
  if(!fields.length&&!wantsItems) throw new HttpError(400,'EMPTY_UPDATE','Provide at least one supported field to update.');
  return inTransaction(pool,async(client)=>{
    const before=await findRecord(client,principal,definition,id,definition.update,true);
    assertPermission(principal,definition.update,before.centre_id);
    let after=before;
    if(fields.length) {
      const entries=[...fields,['updated_by',principal.id]];
      const sets=entries.map(([column],index)=>`${column}=$${index+1}`).join(',');
      const values=entries.map(([,value])=>value);
      values.push(principal.organizationId,before.id);
      const result=await client.query(`UPDATE ${definition.table} SET ${sets},updated_at=now(),version=version+1 WHERE organization_id=$${values.length-1} AND id=$${values.length} RETURNING *`,values);
      after=result.rows[0];
    }
    if(wantsItems) {
      await client.query('DELETE FROM catalogue_package_items WHERE organization_id=$1 AND package_id=$2',[principal.organizationId,before.id]);
      await setPackageItems(client,principal,before.centre_id,before.id,body.items);
    }
    await audit(client,principal,definition,after,`${definition.noun}.updated`,request);
    return {data:await publicFull(client,definition,after,principal)};
  });
}

export const listDoctors=(pool,principal,url)=>listDirectory(pool,principal,url,'doctors');
export const getDoctor=(pool,principal,id)=>getDirectoryRecord(pool,principal,id,'doctors');
export const createDoctor=(pool,principal,body,request)=>createDirectoryRecord(pool,principal,body,request,'doctors');
export const updateDoctor=(pool,principal,id,body,request)=>updateDirectoryRecord(pool,principal,id,body,request,'doctors');
export const listCorporates=(pool,principal,url)=>listDirectory(pool,principal,url,'corporates');
export const getCorporate=(pool,principal,id)=>getDirectoryRecord(pool,principal,id,'corporates');
export const createCorporate=(pool,principal,body,request)=>createDirectoryRecord(pool,principal,body,request,'corporates');
export const updateCorporate=(pool,principal,id,body,request)=>updateDirectoryRecord(pool,principal,id,body,request,'corporates');
export const listPartners=(pool,principal,url)=>listDirectory(pool,principal,url,'partners');
export const getPartner=(pool,principal,id)=>getDirectoryRecord(pool,principal,id,'partners');
export const createPartner=(pool,principal,body,request)=>createDirectoryRecord(pool,principal,body,request,'partners');
export const updatePartner=(pool,principal,id,body,request)=>updateDirectoryRecord(pool,principal,id,body,request,'partners');
export const listCatalogueTests=(pool,principal,url)=>listDirectory(pool,principal,url,'tests');
export const getCatalogueTest=(pool,principal,id)=>getDirectoryRecord(pool,principal,id,'tests');
export const createCatalogueTest=(pool,principal,body,request)=>createDirectoryRecord(pool,principal,body,request,'tests');
export const updateCatalogueTest=(pool,principal,id,body,request)=>updateDirectoryRecord(pool,principal,id,body,request,'tests');
export const listCataloguePackages=(pool,principal,url)=>listDirectory(pool,principal,url,'packages');
export const getCataloguePackage=(pool,principal,id)=>getDirectoryRecord(pool,principal,id,'packages');
export const createCataloguePackage=(pool,principal,body,request)=>createDirectoryRecord(pool,principal,body,request,'packages');
export const updateCataloguePackage=(pool,principal,id,body,request)=>updateDirectoryRecord(pool,principal,id,body,request,'packages');
