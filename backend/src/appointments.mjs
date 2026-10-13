import { assertCentre, assertPermission, hasPermission, HttpError, parsePage, permissionCentres } from './authorization.mjs';
import { decryptField, encryptField } from './security.mjs';
import { randomUUID } from 'node:crypto';

const activeStatuses = ['SCHEDULED','CONFIRMED','CHECKED_IN','IN_SERVICE'];
const transitions = {
  SCHEDULED: ['CONFIRMED','CANCELLED','NO_SHOW'],
  CONFIRMED: ['CHECKED_IN','CANCELLED','NO_SHOW'],
  CHECKED_IN: ['IN_SERVICE'],
  IN_SERVICE: ['COMPLETED'],
  COMPLETED: [], CANCELLED: [], NO_SHOW: []
};
const cancelCodes = new Set(['PATIENT_REQUEST','STAFF_UNAVAILABLE','DUPLICATE','SERVICE_UNAVAILABLE','OTHER']);
const isoDate = (value, field) => {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) throw new HttpError(400,'INVALID_DATE_TIME',`${field} must be a valid ISO date and time.`);
  return date.toISOString();
};

async function transaction(pool, callback) {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const result=await callback(client); await client.query('COMMIT'); return result; }
  catch(error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

function scopeCentres(principal, permission) {
  const centres=permissionCentres(principal,permission);
  if(centres===null) return null;
  if(!centres.length) throw new HttpError(403,'PERMISSION_DENIED','You do not have permission to access these appointments.');
  return centres;
}

function publicAppointment(row,principal) {
  const result={id:row.id,appointmentId:row.public_id,centreId:row.centre_id,patientId:row.patient_public_id,
    serviceType:row.service_type,startsAt:row.starts_at,endsAt:row.ends_at,status:row.status,
    assignedStaffId:row.assigned_staff_id,cancellationCode:row.cancellation_code,
    createdAt:row.created_at,updatedAt:row.updated_at,version:row.version};
  if(row.collection_address_ciphertext&&hasPermission(principal,'patients.address.read',row.patient_centre_id)){
    result.collectionAddress=JSON.parse(decryptField(row.collection_address_ciphertext));
  }
  return result;
}

async function audit(client,principal,action,row,request) {
  await client.query(`INSERT INTO audit_events (organization_id,actor_user_id,actor_type,action,entity_type,entity_id,centre_id,after_json,ip_address,user_agent,request_id,outcome)
    VALUES ($1,$2,'USER',$3,'APPOINTMENT',$4,$5,$6::jsonb,$7,$8,$9,'SUCCESS')`,
  [principal.organizationId,principal.id,action,row.id,row.centre_id,
   JSON.stringify({appointmentId:row.public_id,status:row.status,serviceType:row.service_type,version:row.version}),
   request.socket.remoteAddress?.replace(/^::ffff:/,'')||null,request.headers['user-agent']||null,request.requestId]);
}

async function recordEvent(client,principal,appointmentId,type,previousStatus,newStatus,reasonCode=null){
  await client.query(`INSERT INTO appointment_events (organization_id,appointment_id,event_type,previous_status,new_status,reason_code,actor_user_id,source)
    VALUES ($1,$2,$3,$4,$5,$6,$7,'INTERNAL')`,[principal.organizationId,appointmentId,type,previousStatus,newStatus,reasonCode,principal.id]);
}

async function lockSchedule(client,orgId,centreId,patientId,staffIds=[]) {
  const keys=[`${orgId}:${centreId}:patient:${patientId}`];
  for(const staffId of new Set(staffIds.filter(Boolean)))keys.push(`${orgId}:${centreId}:staff:${staffId}`);
  for(const key of keys.sort()) await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[key]);
}

async function ensureNoConflict(client,orgId,centreId,patientId,startsAt,endsAt,staffId,excludeId=null,otherStaffId=null) {
  await lockSchedule(client,orgId,centreId,patientId,[staffId,otherStaffId]);
  const result=await client.query(`SELECT public_id FROM appointments
    WHERE organization_id=$1 AND centre_id=$2 AND status=ANY($3::text[])
      AND starts_at<$5::timestamptz AND ends_at>$4::timestamptz
      AND ($7::uuid IS NULL OR id<>$7)
      AND (patient_id=$6 OR ($8::uuid IS NOT NULL AND assigned_staff_id=$8))
    LIMIT 1`,[orgId,centreId,activeStatuses,startsAt,endsAt,patientId,excludeId,staffId]);
  if(result.rowCount) throw new HttpError(409,'APPOINTMENT_CONFLICT','The patient or assigned staff member already has an appointment during this time.');
}

async function patientInScope(client,principal,patientId) {
  const result=await client.query(`SELECT id,primary_centre_id FROM patients
    WHERE organization_id=$1 AND (id::text=$2 OR public_id=$2) AND deleted_at IS NULL AND status NOT IN ('BLOCKED','MERGED','DECEASED')`,
  [principal.organizationId,String(patientId)]);
  const patient=result.rows[0];
  if(!patient) throw new HttpError(404,'PATIENT_NOT_FOUND','Patient was not found.');
  assertPermission(principal,'patients.read',patient.primary_centre_id);
  return patient;
}

async function addressSnapshot(client,principal,patient,addressId){
  if(!addressId)throw new HttpError(400,'COLLECTION_ADDRESS_REQUIRED','Select a saved patient address for home collection.');
  assertPermission(principal,'patients.address.read',patient.primary_centre_id);
  const result=await client.query('SELECT address_ciphertext FROM patient_addresses WHERE organization_id=$1 AND patient_id=$2 AND id=$3',
    [principal.organizationId,patient.id,addressId]);
  if(!result.rowCount)throw new HttpError(404,'PATIENT_ADDRESS_NOT_FOUND','Saved patient address was not found.');
  return encryptField(decryptField(result.rows[0].address_ciphertext));
}

async function activeStaffInCentre(client,orgId,staffId,centreId){
  const result=await client.query(`SELECT u.id FROM users u JOIN staff_profiles s ON s.organization_id=u.organization_id AND s.user_id=u.id
    WHERE u.organization_id=$1 AND u.id=$2 AND u.status='active' AND s.employment_status='active'
      AND EXISTS (SELECT 1 FROM user_roles ur WHERE ur.organization_id=u.organization_id AND ur.user_id=u.id AND (ur.centre_id=$3 OR ur.centre_id IS NULL))`,
    [orgId,staffId,centreId]);
  if(!result.rowCount)throw new HttpError(400,'INVALID_ASSIGNEE','Assigned staff member is inactive or not assigned to this centre.');
}

async function findAppointment(client,principal,id,permission,lock=false) {
  const centres=scopeCentres(principal,permission);
  const params=[principal.organizationId,String(id)];
  let centreSql='';
  if(centres!==null){params.push(centres);centreSql=` AND a.centre_id=ANY($${params.length}::uuid[])`;}
  const result=await client.query(`SELECT a.*,p.public_id AS patient_public_id,p.primary_centre_id AS patient_centre_id FROM appointments a
    JOIN patients p ON p.organization_id=a.organization_id AND p.id=a.patient_id
    WHERE a.organization_id=$1 AND (a.id::text=$2 OR a.public_id=$2)${centreSql}${lock?' FOR UPDATE OF a':''}`,params);
  const row=result.rows[0];
  if(!row) throw new HttpError(404,'APPOINTMENT_NOT_FOUND','Appointment was not found.');
  assertCentre(principal,row.centre_id);assertPermission(principal,permission,row.centre_id);
  return row;
}

export async function listAppointments(pool,principal,url) {
  assertPermission(principal,'appointments.read');
  const {limit,offset}=parsePage(url);const requested=url.searchParams.get('centreId');
  const centres=scopeCentres(principal,'appointments.read');
  if(requested){assertCentre(principal,requested);assertPermission(principal,'appointments.read',requested);}
  const status=url.searchParams.get('status');
  if(status&&!Object.hasOwn(transitions,status)) throw new HttpError(400,'INVALID_STATUS','Select a supported appointment status.');
  const from=url.searchParams.get('from');const to=url.searchParams.get('to');
  const fromDate=from?isoDate(from,'from'):null;const toDate=to?isoDate(to,'to'):null;
  if(fromDate&&toDate&&fromDate>=toDate) throw new HttpError(400,'INVALID_DATE_RANGE','The end of the search range must follow its start.');
  const params=[principal.organizationId,requested||null,status||null,fromDate,toDate];
  let where=`a.organization_id=$1 AND ($2::uuid IS NULL OR a.centre_id=$2) AND ($3::text IS NULL OR a.status=$3)
    AND ($4::timestamptz IS NULL OR a.starts_at >= $4) AND ($5::timestamptz IS NULL OR a.starts_at < $5)`;
  if(!requested&&centres!==null){params.push(centres);where+=` AND a.centre_id=ANY($${params.length}::uuid[])`;}
  params.push(limit,offset);const lim=params.length-1,off=params.length;
  const result=await pool.query(`SELECT a.*,p.public_id AS patient_public_id,p.primary_centre_id AS patient_centre_id FROM appointments a
    JOIN patients p ON p.organization_id=a.organization_id AND p.id=a.patient_id
    WHERE ${where} ORDER BY a.starts_at,a.created_at LIMIT $${lim} OFFSET $${off}`,params);
  return {data:result.rows.map(row=>publicAppointment(row,principal)),meta:{limit,offset}};
}

export async function getAppointment(pool,principal,id) {
  assertPermission(principal,'appointments.read');const client=await pool.connect();
  try{return {data:publicAppointment(await findAppointment(client,principal,id,'appointments.read'),principal)};}
  finally{client.release();}
}

export async function createAppointment(pool,principal,body,request) {
  assertPermission(principal,'appointments.create');
  const centreId=body.centreId||principal.primaryCentreId;
  if(!centreId) throw new HttpError(400,'CENTRE_REQUIRED','Select an assigned centre before scheduling.');
  assertCentre(principal,centreId);assertPermission(principal,'appointments.create',centreId);
  const serviceType=String(body.serviceType||'').toUpperCase();
  if(!['CENTRE_VISIT','HOME_COLLECTION'].includes(serviceType)) throw new HttpError(400,'INVALID_SERVICE_TYPE','Select CENTRE_VISIT or HOME_COLLECTION.');
  const startsAt=isoDate(body.startsAt,'startsAt'),endsAt=isoDate(body.endsAt,'endsAt');
  const duration=Date.parse(endsAt)-Date.parse(startsAt);
  if(duration<=0||duration>12*60*60*1000) throw new HttpError(400,'INVALID_APPOINTMENT_WINDOW','Appointment duration must be greater than zero and at most 12 hours.');
  const patientId=String(body.patientId||'');if(!patientId)throw new HttpError(400,'PATIENT_REQUIRED','A patient is required.');
  assertPermission(principal,'patients.read');
  return transaction(pool,async(client)=>{
    const patient=await patientInScope(client,principal,patientId);
    const staffId=body.assignedStaffId||null;
    if(staffId)await activeStaffInCentre(client,principal.organizationId,staffId,centreId);
    const addressCiphertext=serviceType==='HOME_COLLECTION'?await addressSnapshot(client,principal,patient,body.addressId):null;
    if(serviceType==='CENTRE_VISIT'&&body.addressId)throw new HttpError(400,'INVALID_COLLECTION_ADDRESS','A centre visit cannot include a collection address.');
    await ensureNoConflict(client,principal.organizationId,centreId,patient.id,startsAt,endsAt,staffId);
    const publicId=`RHC-APT-${randomUUID().replaceAll('-','').slice(0,12).toUpperCase()}`;
    const inserted=await client.query(`INSERT INTO appointments (organization_id,public_id,centre_id,patient_id,service_type,starts_at,ends_at,assigned_staff_id,collection_address_ciphertext,created_by,updated_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING *`,
    [principal.organizationId,publicId,centreId,patient.id,serviceType,startsAt,endsAt,staffId,addressCiphertext,principal.id]);
    const patientInfo=(await client.query('SELECT public_id,primary_centre_id FROM patients WHERE id=$1',[patient.id])).rows[0];
    const row={...inserted.rows[0],patient_public_id:patientInfo.public_id,patient_centre_id:patientInfo.primary_centre_id};
    await recordEvent(client,principal,row.id,'SCHEDULED',null,row.status);
    await audit(client,principal,'appointment.created',row,request);return {data:publicAppointment(row,principal)};
  });
}

export async function updateAppointment(pool,principal,id,body,request) {
  assertPermission(principal,'appointments.update');
  const hasTime=Object.hasOwn(body,'startsAt')||Object.hasOwn(body,'endsAt');
  if(!hasTime&&!Object.hasOwn(body,'assignedStaffId')&&!Object.hasOwn(body,'serviceType')&&!Object.hasOwn(body,'addressId'))throw new HttpError(400,'EMPTY_UPDATE','Provide a supported scheduling field.');
  return transaction(pool,async(client)=>{
    const before=await findAppointment(client,principal,id,'appointments.update',true);
    if(!['SCHEDULED','CONFIRMED'].includes(before.status))throw new HttpError(409,'APPOINTMENT_LOCKED','Only scheduled or confirmed appointments can be rescheduled.');
    const startsAt=Object.hasOwn(body,'startsAt')?isoDate(body.startsAt,'startsAt'):new Date(before.starts_at).toISOString();
    const endsAt=Object.hasOwn(body,'endsAt')?isoDate(body.endsAt,'endsAt'):new Date(before.ends_at).toISOString();
    const duration=Date.parse(endsAt)-Date.parse(startsAt);if(duration<=0||duration>12*60*60*1000)throw new HttpError(400,'INVALID_APPOINTMENT_WINDOW','Appointment duration must be greater than zero and at most 12 hours.');
    const staffId=Object.hasOwn(body,'assignedStaffId')?body.assignedStaffId||null:before.assigned_staff_id;
    if(staffId)await activeStaffInCentre(client,principal.organizationId,staffId,before.centre_id);
    const serviceType=Object.hasOwn(body,'serviceType')?String(body.serviceType).toUpperCase():before.service_type;
    if(!['CENTRE_VISIT','HOME_COLLECTION'].includes(serviceType))throw new HttpError(400,'INVALID_SERVICE_TYPE','Select CENTRE_VISIT or HOME_COLLECTION.');
    let addressCiphertext=before.collection_address_ciphertext;
    if(serviceType==='HOME_COLLECTION'&&Object.hasOwn(body,'addressId'))addressCiphertext=await addressSnapshot(client,principal,{id:before.patient_id,primary_centre_id:before.patient_centre_id},body.addressId);
    if(serviceType==='HOME_COLLECTION'&&!addressCiphertext)throw new HttpError(400,'COLLECTION_ADDRESS_REQUIRED','Select a saved patient address for home collection.');
    if(serviceType==='CENTRE_VISIT'){addressCiphertext=null;if(body.addressId)throw new HttpError(400,'INVALID_COLLECTION_ADDRESS','A centre visit cannot include a collection address.');}
    await ensureNoConflict(client,principal.organizationId,before.centre_id,before.patient_id,startsAt,endsAt,staffId,before.id,before.assigned_staff_id);
    const result=await client.query(`UPDATE appointments SET starts_at=$3,ends_at=$4,assigned_staff_id=$5,service_type=$6,collection_address_ciphertext=$7,updated_by=$8,updated_at=now(),version=version+1
      WHERE organization_id=$1 AND id=$2 RETURNING *`,[principal.organizationId,before.id,startsAt,endsAt,staffId,serviceType,addressCiphertext,principal.id]);
    const row={...result.rows[0],patient_public_id:before.patient_public_id,patient_centre_id:before.patient_centre_id};
    await recordEvent(client,principal,row.id,hasTime?'RESCHEDULED':'UPDATED',before.status,row.status);
    await audit(client,principal,'appointment.updated',row,request);return {data:publicAppointment(row,principal)};
  });
}

export async function transitionAppointment(pool,principal,id,body,request) {
  assertPermission(principal,'appointments.status');const next=String(body.status||'').toUpperCase();
  if(!Object.hasOwn(transitions,next))throw new HttpError(400,'INVALID_STATUS','Select a supported appointment status.');
  const code=body.cancellationCode?String(body.cancellationCode).toUpperCase():null;
  if(next==='CANCELLED'&&!cancelCodes.has(code))throw new HttpError(400,'CANCELLATION_CODE_REQUIRED','Select a cancellation reason code.');
  if(next!=='CANCELLED'&&code)throw new HttpError(400,'INVALID_CANCELLATION_CODE','A cancellation code is only valid when cancelling.');
  return transaction(pool,async(client)=>{
    const before=await findAppointment(client,principal,id,'appointments.status',true);
    if(!transitions[before.status].includes(next))throw new HttpError(409,'INVALID_APPOINTMENT_TRANSITION',`Appointment cannot move from ${before.status} to ${next}.`);
    const result=await client.query(`UPDATE appointments SET status=$3,cancellation_code=$4,updated_by=$5,updated_at=now(),version=version+1
      WHERE organization_id=$1 AND id=$2 RETURNING *`,[principal.organizationId,before.id,next,code,principal.id]);
    const row={...result.rows[0],patient_public_id:before.patient_public_id,patient_centre_id:before.patient_centre_id};
    await recordEvent(client,principal,row.id,'STATUS_CHANGED',before.status,row.status,code);
    await audit(client,principal,`appointment.${next.toLowerCase()}`,row,request);return {data:publicAppointment(row,principal)};
  });
}
