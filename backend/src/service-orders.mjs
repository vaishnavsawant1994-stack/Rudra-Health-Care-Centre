import { assertCentre, assertPermission, HttpError, parsePage, permissionCentres } from './authorization.mjs';
import { createHash, randomUUID } from 'node:crypto';

const transitions={
  BOOKED:['SAMPLE_COLLECTED','CANCELLED'],
  SAMPLE_COLLECTED:['IN_PROCESS'],
  IN_PROCESS:['PARTIAL','COMPLETED'],
  PARTIAL:['IN_PROCESS','COMPLETED'],
  COMPLETED:[],CANCELLED:[]
};
const cancelCodes=new Set(['PATIENT_REQUEST','STAFF_REQUEST','DUPLICATE','SERVICE_UNAVAILABLE','OTHER']);

async function transaction(pool,callback){
  const client=await pool.connect();
  try{await client.query('BEGIN');const result=await callback(client);await client.query('COMMIT');return result;}
  catch(error){await client.query('ROLLBACK');throw error;}
  finally{client.release();}
}

function scopedCentres(principal,permission){
  const centres=permissionCentres(principal,permission);
  if(centres===null)return null;
  if(!centres.length)throw new HttpError(403,'PERMISSION_DENIED','You do not have permission to access service orders.');
  return centres;
}

async function audit(client,principal,action,row,request){
  await client.query(`INSERT INTO audit_events (organization_id,actor_user_id,actor_type,action,entity_type,entity_id,centre_id,after_json,ip_address,user_agent,request_id,outcome)
    VALUES ($1,$2,'USER',$3,'SERVICE_ORDER',$4,$5,$6::jsonb,$7,$8,$9,'SUCCESS')`,
  [principal.organizationId,principal.id,action,row.id,row.centre_id,
    JSON.stringify({orderId:row.public_id,status:row.status,appointmentId:row.appointment_id,version:row.version}),
    request.socket.remoteAddress?.replace(/^::ffff:/,'')||null,request.headers['user-agent']||null,request.requestId]);
}

async function recordEvent(client,principal,orderId,eventType,previousStatus,newStatus,reasonCode=null){
  await client.query(`INSERT INTO service_order_events (organization_id,order_id,event_type,previous_status,new_status,reason_code,actor_user_id,source)
    VALUES ($1,$2,$3,$4,$5,$6,$7,'INTERNAL')`,[principal.organizationId,orderId,eventType,previousStatus,newStatus,reasonCode,principal.id]);
}

async function orderItems(client,principal,orderId){
  const result=await client.query(`SELECT i.id,i.item_code,i.item_name,i.quantity,i.unit_price_minor,i.currency,
      t.public_id AS test_public_id,p.public_id AS package_public_id
    FROM service_order_items i
    LEFT JOIN catalogue_tests t ON t.organization_id=i.organization_id AND t.id=i.test_id AND t.centre_id=i.centre_id
    LEFT JOIN catalogue_packages p ON p.organization_id=i.organization_id AND p.id=i.package_id AND p.centre_id=i.centre_id
    WHERE i.organization_id=$1 AND i.order_id=$2 ORDER BY i.created_at,i.id`,[principal.organizationId,orderId]);
  return result.rows.map(row=>({id:row.id,testId:row.test_public_id,packageId:row.package_public_id,
    code:row.item_code,name:row.item_name,quantity:row.quantity,unitPriceMinor:row.unit_price_minor,currency:row.currency}));
}

async function serialize(client,principal,row,includeItems=true){
  const patient=await client.query('SELECT public_id FROM patients WHERE organization_id=$1 AND id=$2',[principal.organizationId,row.patient_id]);
  const appointment=row.appointment_id?await client.query('SELECT public_id FROM appointments WHERE organization_id=$1 AND id=$2',[principal.organizationId,row.appointment_id]):null;
  return {id:row.id,orderId:row.public_id,centreId:row.centre_id,patientId:patient.rows[0]?.public_id,
    appointmentId:appointment?.rows[0]?.public_id||null, status:row.status,cancellationCode:row.cancellation_code,
    items:includeItems?await orderItems(client,principal,row.id):undefined,
    createdAt:row.created_at,updatedAt:row.updated_at,version:row.version};
}

async function findOrder(client,principal,id,permission,lock=false){
  const centres=scopedCentres(principal,permission);const params=[principal.organizationId,String(id)];let scope='';
  if(centres!==null){params.push(centres);scope=` AND centre_id=ANY($${params.length}::uuid[])`;}
  const result=await client.query(`SELECT * FROM service_orders WHERE organization_id=$1 AND (id::text=$2 OR public_id=$2)${scope}${lock?' FOR UPDATE':''}`,params);
  const row=result.rows[0];if(!row)throw new HttpError(404,'SERVICE_ORDER_NOT_FOUND','Service order was not found.');
  assertCentre(principal,row.centre_id);assertPermission(principal,permission,row.centre_id);return row;
}

async function resolveItem(client,principal,centreId,item){
  if(!item||typeof item!=='object')throw new HttpError(400,'INVALID_ORDER_ITEM','Each order item must reference a test or package.');
  const testRef=item.testId;const packageRef=item.packageId;
  if(Boolean(testRef)===Boolean(packageRef))throw new HttpError(400,'INVALID_ORDER_ITEM','Choose exactly one test or package for each item.');
  const isTest=Boolean(testRef);const permission=isTest?'catalogue.tests.read':'catalogue.packages.read';
  assertPermission(principal,permission,centreId);
  const ref=String(isTest?testRef:packageRef);
  const table=isTest?'catalogue_tests':'catalogue_packages';
  const result=await client.query(`SELECT id,public_id,code,name,price_minor,currency,status FROM ${table}
    WHERE organization_id=$1 AND centre_id=$2 AND (id::text=$3 OR public_id=$3)`,[principal.organizationId,centreId,ref]);
  const record=result.rows[0];if(!record||record.status!=='ACTIVE')throw new HttpError(400,'CATALOGUE_ITEM_UNAVAILABLE','Every order item must be active in the selected centre.');
  const quantity=Number(item.quantity??1);if(!Number.isInteger(quantity)||quantity<1||quantity>100)throw new HttpError(400,'INVALID_ORDER_QUANTITY','Quantity must be a whole number from 1 to 100.');
  return {testId:isTest?record.id:null,packageId:isTest?null:record.id,code:record.code,name:record.name,
    quantity,priceMinor:record.price_minor,currency:record.currency};
}

async function replaceItems(client,principal,centreId,orderId,items){
  if(!Array.isArray(items)||items.length<1||items.length>100)throw new HttpError(400,'INVALID_ORDER_ITEMS','An order must contain between 1 and 100 items.');
  const resolved=[];
  for(const item of items)resolved.push(await resolveItem(client,principal,centreId,item));
  await client.query('DELETE FROM service_order_items WHERE organization_id=$1 AND order_id=$2',[principal.organizationId,orderId]);
  for(const item of resolved)await client.query(`INSERT INTO service_order_items
    (organization_id,centre_id,order_id,test_id,package_id,item_code,item_name,quantity,unit_price_minor,currency)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
  [principal.organizationId,centreId,orderId,item.testId,item.packageId,item.code,item.name,item.quantity,item.priceMinor,item.currency]);
}

export async function listServiceOrders(pool,principal,url){
  assertPermission(principal,'service_orders.read');const {limit,offset}=parsePage(url);const requested=url.searchParams.get('centreId');
  const centres=scopedCentres(principal,'service_orders.read');if(requested){assertCentre(principal,requested);assertPermission(principal,'service_orders.read',requested);}
  const status=url.searchParams.get('status');if(status&&!Object.hasOwn(transitions,status))throw new HttpError(400,'INVALID_STATUS','Select a supported service order status.');
  const params=[principal.organizationId,requested||null,status||null];let where='organization_id=$1 AND ($2::uuid IS NULL OR centre_id=$2) AND ($3::text IS NULL OR status=$3)';
  if(!requested&&centres!==null){params.push(centres);where+=` AND centre_id=ANY($${params.length}::uuid[])`;}
  params.push(limit,offset);const lim=params.length-1,off=params.length;
  const page=await pool.query(`SELECT * FROM service_orders WHERE ${where} ORDER BY created_at DESC LIMIT $${lim} OFFSET $${off}`,params);
  const client=await pool.connect();try{return {data:await Promise.all(page.rows.map(row=>serialize(client,principal,row,false))),meta:{limit,offset}};}finally{client.release();}
}

export async function getServiceOrder(pool,principal,id){
  assertPermission(principal,'service_orders.read');const client=await pool.connect();
  try{const row=await findOrder(client,principal,id,'service_orders.read');return {data:await serialize(client,principal,row)};}finally{client.release();}
}

export async function createServiceOrder(pool,principal,body,request){
  assertPermission(principal,'service_orders.create');const centreId=body.centreId||principal.primaryCentreId;
  if(!centreId)throw new HttpError(400,'CENTRE_REQUIRED','Select an assigned centre before creating an order.');
  assertCentre(principal,centreId);assertPermission(principal,'service_orders.create',centreId);
  assertPermission(principal,'patients.read');const patientRef=String(body.patientId||'');if(!patientRef)throw new HttpError(400,'PATIENT_REQUIRED','A patient is required.');
  const idempotencyKey=request.headers['idempotency-key'];
  if(typeof idempotencyKey!=='string'||!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey))throw new HttpError(400,'IDEMPOTENCY_KEY_REQUIRED','Provide an Idempotency-Key header of 8 to 128 safe characters.');
  if(!Array.isArray(body.items)||body.items.length<1||body.items.length>100)throw new HttpError(400,'INVALID_ORDER_ITEMS','An order must contain between 1 and 100 items.');
  const requestHash=createHash('sha256').update(JSON.stringify({centreId,patientRef,appointmentRef:body.appointmentId||null,items:body.items.map(item=>({testId:item?.testId||null,packageId:item?.packageId||null,quantity:item?.quantity??1}))})).digest();
  return transaction(pool,async(client)=>{
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${principal.organizationId}:service-order:${idempotencyKey}`]);
    const prior=await client.query('SELECT * FROM service_orders WHERE organization_id=$1 AND idempotency_key=$2 FOR UPDATE',[principal.organizationId,idempotencyKey]);
    if(prior.rowCount){
      if(!prior.rows[0].request_hash.equals(requestHash))throw new HttpError(409,'IDEMPOTENCY_KEY_REUSED','This Idempotency-Key was already used for a different order request.');
      return {data:await serialize(client,principal,prior.rows[0])};
    }
    const patientResult=await client.query(`SELECT id,primary_centre_id FROM patients WHERE organization_id=$1
      AND (id::text=$2 OR public_id=$2) AND deleted_at IS NULL AND status NOT IN ('BLOCKED','MERGED','DECEASED')`,[principal.organizationId,patientRef]);
    const patient=patientResult.rows[0];if(!patient)throw new HttpError(404,'PATIENT_NOT_FOUND','Patient was not found.');
    assertPermission(principal,'patients.read',patient.primary_centre_id);
    const appointmentRef=body.appointmentId?String(body.appointmentId):null;let appointmentId=null;
    if(appointmentRef){assertPermission(principal,'appointments.read',centreId);
      const appointment=await client.query(`SELECT id,status,patient_id,centre_id FROM appointments WHERE organization_id=$1
        AND (id::text=$2 OR public_id=$2) FOR UPDATE`,[principal.organizationId,appointmentRef]);
      const record=appointment.rows[0];if(!record||record.centre_id!==centreId)throw new HttpError(404,'APPOINTMENT_NOT_FOUND','Appointment was not found in this centre.');
      if(record.patient_id!==patient.id||!['SCHEDULED','CONFIRMED'].includes(record.status))throw new HttpError(409,'APPOINTMENT_NOT_BOOKABLE','The appointment must be scheduled or confirmed for this patient.');
      appointmentId=record.id;
    }
    const publicId=`RHC-ORD-${randomUUID().replaceAll('-','').slice(0,12).toUpperCase()}`;
    const created=await client.query(`INSERT INTO service_orders (organization_id,public_id,idempotency_key,request_hash,centre_id,patient_id,appointment_id,created_by,updated_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING *`,[principal.organizationId,publicId,idempotencyKey,requestHash,centreId,patient.id,appointmentId,principal.id]);
    await replaceItems(client,principal,centreId,created.rows[0].id,body.items);
    await recordEvent(client,principal,created.rows[0].id,'CREATED',null,created.rows[0].status);
    await audit(client,principal,'service_order.created',created.rows[0],request);
    return {data:await serialize(client,principal,created.rows[0])};
  });
}

export async function updateServiceOrder(pool,principal,id,body,request){
  assertPermission(principal,'service_orders.update');if(!Object.hasOwn(body,'items'))throw new HttpError(400,'EMPTY_UPDATE','Provide replacement order items.');
  return transaction(pool,async(client)=>{
    const before=await findOrder(client,principal,id,'service_orders.update',true);
    if(before.status!=='BOOKED')throw new HttpError(409,'ORDER_LOCKED','Order items can only be changed while the order is BOOKED.');
    await replaceItems(client,principal,before.centre_id,before.id,body.items);
    const updated=await client.query(`UPDATE service_orders SET updated_by=$3,updated_at=now(),version=version+1 WHERE organization_id=$1 AND id=$2 RETURNING *`,
      [principal.organizationId,before.id,principal.id]);
    await recordEvent(client,principal,before.id,'ITEMS_UPDATED',before.status,updated.rows[0].status);
    await audit(client,principal,'service_order.items_updated',updated.rows[0],request);
    return {data:await serialize(client,principal,updated.rows[0])};
  });
}

export async function transitionServiceOrder(pool,principal,id,body,request){
  assertPermission(principal,'service_orders.status');const next=String(body.status||'').toUpperCase();
  if(!Object.hasOwn(transitions,next))throw new HttpError(400,'INVALID_STATUS','Select a supported service order status.');
  const code=body.cancellationCode?String(body.cancellationCode).toUpperCase():null;
  if(next==='CANCELLED'&&!cancelCodes.has(code))throw new HttpError(400,'CANCELLATION_CODE_REQUIRED','Select a cancellation reason code.');
  if(next!=='CANCELLED'&&code)throw new HttpError(400,'INVALID_CANCELLATION_CODE','A cancellation code is only valid when cancelling.');
  return transaction(pool,async(client)=>{
    const before=await findOrder(client,principal,id,'service_orders.status',true);
    if(!transitions[before.status].includes(next))throw new HttpError(409,'INVALID_ORDER_TRANSITION',`Service order cannot move from ${before.status} to ${next}.`);
    const result=await client.query(`UPDATE service_orders SET status=$3,cancellation_code=$4,updated_by=$5,updated_at=now(),version=version+1
      WHERE organization_id=$1 AND id=$2 RETURNING *`,[principal.organizationId,before.id,next,code,principal.id]);
    await recordEvent(client,principal,before.id,'STATUS_CHANGED',before.status,next,code);
    await audit(client,principal,`service_order.${next.toLowerCase()}`,result.rows[0],request);
    return {data:await serialize(client,principal,result.rows[0])};
  });
}
