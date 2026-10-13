import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { HttpError } from '../src/authorization.mjs';
import {
  addExternalIdentifier, addFamilyMember, addLeadActivity, addPatientAddress, convertLead, createLead, createPatient,
  endFamilyRelationship, getLeadDetail, getPatientDetail, listExternalIdentifiers, listFamily, listLeads,
  listPatientAddresses, listPatients, markLeadLost, patientTimeline, updateExternalIdentifier, updatePatient, updateLead
} from '../src/records.mjs';
import {
  createCataloguePackage, createCatalogueTest, createCorporate, createDoctor, createPartner,
  getCataloguePackage, getDoctor, listDoctors, updateCataloguePackage
} from '../src/directory.mjs';

const enabled = Boolean(process.env.DATABASE_URL);
if (process.env.CI === 'true' && !enabled) {
  throw new Error('DATABASE_URL is required in CI; PostgreSQL integration coverage must not be skipped.');
}
process.env.RUDRA_FIELD_ENCRYPTION_KEY ||= Buffer.alloc(32, 31).toString('base64');
process.env.RUDRA_LOOKUP_HMAC_KEY ||= Buffer.alloc(32, 32).toString('base64');

test('all checked-in migrations were applied to PostgreSQL 15 or newer', { skip: !enabled }, async () => {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const version = await pool.query('SHOW server_version_num');
    assert.ok(Number(version.rows[0].server_version_num) >= 150000, 'PostgreSQL 15+ is required');
    const applied = await pool.query('SELECT version FROM schema_migrations ORDER BY version');
    assert.deepEqual(applied.rows.map((row) => row.version), [
      '001_organization_centres.sql',
      '002_users_roles_permissions.sql',
      '003_patients_family.sql',
      '004_leads_consents_audit.sql',
      '005_auth_sessions.sql',
      '006_default_authorization.sql',
      '007_encrypt_patient_addresses.sql',
      '008_doctors.sql',
      '009_corporates.sql',
      '010_partners.sql',
      '011_test_package_catalogue.sql'
    ]);
  } finally {
    await pool.end();
  }
});

test('PostgreSQL patient, family, lead, centre and append-only audit flow', { skip: !enabled }, async () => {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const request = { requestId: randomUUID(), headers: { 'user-agent': 'rhc-integration-test' }, socket: { remoteAddress: '127.0.0.1' } };
  try {
    const organizationId = (await pool.query(
      `INSERT INTO organizations (public_id,name,brand_name) VALUES ($1,'Rudra Integration Test','Rudra Test') RETURNING id`,
      [`TEST-ORG-${randomUUID()}`]
    )).rows[0].id;
    const foreignOrganizationId = (await pool.query(
      `INSERT INTO organizations (public_id,name,brand_name) VALUES ($1,'Rudra Other Test','Other Test') RETURNING id`,
      [`TEST-ORG-${randomUUID()}`]
    )).rows[0].id;
    const centreId = (await pool.query(
      `INSERT INTO centres (organization_id,public_id,name,centre_type,address_line_1,city,state,postal_code)
       VALUES ($1,$2,'Test Centre','MAIN','1 Test Road','Nashik','Maharashtra','422001') RETURNING id`,
      [organizationId, `TEST-CEN-${randomUUID()}`]
    )).rows[0].id;
    const otherCentreId = (await pool.query(
      `INSERT INTO centres (organization_id,public_id,name,centre_type,address_line_1,city,state,postal_code)
       VALUES ($1,$2,'Other Centre','SATELLITE','2 Test Road','Pune','Maharashtra','411001') RETURNING id`,
      [organizationId, `TEST-CEN-${randomUUID()}`]
    )).rows[0].id;
    const foreignCentreId = (await pool.query(
      `INSERT INTO centres (organization_id,public_id,name,centre_type,address_line_1,city,state,postal_code)
       VALUES ($1,$2,'Foreign Centre','MAIN','3 Test Road','Mumbai','Maharashtra','400001') RETURNING id`,
      [foreignOrganizationId, `TEST-CEN-${randomUUID()}`]
    )).rows[0].id;
    const userId = (await pool.query(
      `INSERT INTO users (organization_id,public_id,auth_subject,status) VALUES ($1,$2,$3,'active') RETURNING id`,
      [organizationId, `TEST-STF-${randomUUID()}`, `integration:${randomUUID()}`]
    )).rows[0].id;
    await pool.query(
      `INSERT INTO staff_profiles (user_id,organization_id,public_id,first_name,display_name,primary_centre_id)
       VALUES ($1,$2,$3,'Test','Test Owner',$4)`,
      [userId, organizationId, `TEST-PROFILE-${randomUUID()}`, centreId]
    );
    const ownerRole = (await pool.query('SELECT id FROM roles WHERE organization_id=$1 AND code=\'OWNER\'', [organizationId])).rows[0].id;
    await pool.query('INSERT INTO user_roles (organization_id,user_id,role_id,centre_id,assigned_by) VALUES ($1,$2,$3,NULL,$2)', [organizationId,userId,ownerRole]);
    const ownerPermissions = new Set((await pool.query('SELECT code FROM permissions')).rows.map((row) => row.code));
    const owner = { id: userId, organizationId, primaryCentreId: centreId, centres: [null], permissions: ownerPermissions,
      permissionCentres: new Map([...ownerPermissions].map((code) => [code, [null]])) };

    const doctor=await createDoctor(pool,owner,{firstName:'Synthetic',lastName:'Doctor',specialty:'Test specialty',qualification:'Test qualification',
      registrationNumber:'SYN-REG-1001',mobile:'+919876500106',email:'doctor@example.test',centreId},request);
    assert.match(doctor.data.doctorId,/^RHC-DOC-\d{6}$/);
    assert.equal(doctor.data.registrationNumber,'SYN-REG-1001');
    const doctorStored=await pool.query('SELECT registration_ciphertext,registration_lookup_hash,mobile_ciphertext,email_ciphertext FROM doctors WHERE id=$1',[doctor.data.id]);
    assert.equal(doctorStored.rows[0].registration_ciphertext.toString('utf8').includes('SYN-REG-1001'),false);
    assert.equal(doctorStored.rows[0].mobile_ciphertext.toString('utf8').includes('9876500106'),false);
    assert.equal(doctorStored.rows[0].email_ciphertext.toString('utf8').includes('doctor@example.test'),false);
    const corporate=await createCorporate(pool,owner,{name:'Synthetic Corporate',industry:'Test',contactName:'Test Contact',
      mobile:'+919876500107',email:'corporate@example.test',centreId},request);
    const partner=await createPartner(pool,owner,{partnerType:'REFERRAL',name:'Synthetic Partner',contactName:'Test Contact',
      mobile:'+919876500108',email:'partner@example.test',centreId},request);
    const catalogueTest=await createCatalogueTest(pool,owner,{code:`SYN-${randomUUID().slice(0,8)}`,name:'Synthetic Blood Test',
      category:'Synthetic',specimenType:'Synthetic specimen',fastingRequired:true,turnaroundHours:24,priceMinor:12000,centreId},request);
    const otherCentreTest=await createCatalogueTest(pool,owner,{code:`OTH-${randomUUID().slice(0,8)}`,name:'Other Centre Test',centreId:otherCentreId},request);
    const packageRecord=await createCataloguePackage(pool,owner,{code:`PKG-${randomUUID().slice(0,8)}`,name:'Synthetic Health Package',
      priceMinor:25000,centreId,items:[{testId:catalogueTest.data.testId,quantity:1}]},request);
    assert.match(packageRecord.data.packageId,/^RHC-PKG-\d{6}$/);
    assert.equal(packageRecord.data.items[0].testId,catalogueTest.data.testId);
    await assert.rejects(createCataloguePackage(pool,owner,{code:`BAD-${randomUUID().slice(0,8)}`,name:'Invalid Centre Package',
      centreId,items:[{testId:otherCentreTest.data.testId}]},request),
      (error)=>error instanceof HttpError&&error.code==='INVALID_PACKAGE_ITEMS');
    await assert.rejects(pool.query(
      `INSERT INTO catalogue_package_items (organization_id,centre_id,package_id,test_id)
       VALUES ($1,$2,$3,$4)`,
      [organizationId,centreId,packageRecord.data.id,otherCentreTest.data.id]
    ),(error)=>error.code==='23503');
    const changedPackage=await updateCataloguePackage(pool,owner,packageRecord.data.packageId,
      {status:'INACTIVE',items:[{testId:catalogueTest.data.testId,quantity:2}]},request);
    assert.equal(changedPackage.data.status,'INACTIVE');
    assert.equal((await getCataloguePackage(pool,owner,packageRecord.data.packageId)).data.items[0].quantity,2);
    const limitedDirectoryReader={id:userId,organizationId,primaryCentreId:centreId,centres:[centreId],
      permissions:new Set(['doctors.read']),permissionCentres:new Map([['doctors.read',[centreId]]])};
    const directoryPage=await listDoctors(pool,limitedDirectoryReader,new URL('https://rudra.invalid/api/v1/doctors'));
    assert.match(directoryPage.data[0].mobile,/^•+0106$/);
    assert.equal(directoryPage.data[0].registrationNumber,'••••1001');
    const otherCentreDoctor=await createDoctor(pool,owner,{firstName:'Other',centreId:otherCentreId},request);
    await assert.rejects(getDoctor(pool,limitedDirectoryReader,otherCentreDoctor.data.doctorId),
      (error)=>error instanceof HttpError&&error.status===404);
    const corporateBytes=await pool.query('SELECT contact_mobile_ciphertext,contact_email_ciphertext FROM corporates WHERE id=$1',[corporate.data.id]);
    assert.equal(corporateBytes.rows[0].contact_mobile_ciphertext.toString('utf8').includes('9876500107'),false);
    assert.equal(corporateBytes.rows[0].contact_email_ciphertext.toString('utf8').includes('corporate@example.test'),false);
    const directoryAudit=await pool.query("SELECT action FROM audit_events WHERE organization_id=$1 AND action IN ('doctor.created','corporate.created','partner.created','test.created','package.created','package.updated')",[organizationId]);
    assert.ok(directoryAudit.rows.length>=6);

    const patientLinked=await createPatient(pool,owner,{firstName:'Linked Test',centreId,referredDoctorId:doctor.data.doctorId,
      corporateId:corporate.data.corporateId,referredPartnerId:partner.data.partnerId},request);
    assert.equal(patientLinked.data.referredDoctorId,doctor.data.id);
    assert.equal(patientLinked.data.corporateId,corporate.data.id);
    assert.equal(patientLinked.data.referredPartnerId,partner.data.id);
    await assert.rejects(pool.query(
      `UPDATE patients SET referred_doctor_id=$1 WHERE id=$2`,
      [otherCentreDoctor.data.id,patientLinked.data.id]
    ),(error)=>error.code==='23503');
    const leadWithPartner=await createLead(pool,owner,{firstName:'Partner Lead',source:'PARTNER',centreId,partnerId:partner.data.partnerId},request);
    assert.equal(leadWithPartner.data.partner_id,partner.data.id);
    const convertedPartnerLead=await convertLead(pool,owner,leadWithPartner.data.id,{},request);
    const convertedPatient=await pool.query('SELECT referred_partner_id FROM patients WHERE public_id=$1',[convertedPartnerLead.data.patientId]);
    assert.equal(convertedPatient.rows[0].referred_partner_id,partner.data.id);
    await assert.rejects(pool.query('UPDATE audit_events SET action=\'rewritten\' WHERE organization_id=$1 AND action=\'doctor.created\'',[organizationId]));

    const created = await createPatient(pool, owner, { firstName: 'Asha', lastName: 'Test', mobile: '+919876500101', email: 'asha@example.test', centreId }, request);
    assert.match(created.data.patientId, /^RHC-PAT-\d{6}$/);
    assert.equal(created.data.mobile, '+919876500101');
    const updated = await updatePatient(pool, owner, created.data.patientId, { lastName: 'Updated' }, request);
    assert.equal(updated.data.lastName, 'Updated');
    await assert.rejects(createPatient(pool, owner, { firstName: 'Duplicate', mobile: '+919876500101', centreId }, request),
      (error) => error instanceof HttpError && error.status === 409 && error.code === 'POSSIBLE_DUPLICATE');
    const concurrentCreates = await Promise.allSettled([
      createPatient(pool, owner, { firstName: 'Concurrent A', mobile: '+919876500105', centreId }, request),
      createPatient(pool, owner, { firstName: 'Concurrent B', mobile: '+919876500105', centreId }, request)
    ]);
    assert.equal(concurrentCreates.filter((item) => item.status === 'fulfilled').length, 1);
    assert.equal(concurrentCreates.filter((item) => item.status === 'rejected' && item.reason.code === 'POSSIBLE_DUPLICATE').length, 1);

    const second = await createPatient(pool, owner, { firstName: 'Ravi', mobile: '+919876500101', centreId,
      allowDuplicate: true, duplicateOverrideReason: 'Family member shares household contact number' }, request);
    const family = await addFamilyMember(pool, owner, created.data.patientId, { relatedPatientId: second.data.patientId, relationshipType: 'CHILD' }, request);
    assert.equal(family.data.relatedPatientId, second.data.patientId);
    assert.equal((await listFamily(pool, owner, created.data.patientId)).data.length, 1);
    await endFamilyRelationship(pool, owner, created.data.patientId, family.data.relationshipId, request);
    assert.equal((await listFamily(pool, owner, created.data.patientId)).data.length, 0);

    const external = await addExternalIdentifier(pool, owner, created.data.patientId, {
      provider: 'Metropolis', identifierType: 'Patient ID', externalIdentifier: 'MP-TEST-001', metadata: { source: 'manual' }
    }, request);
    assert.equal(external.data.provider, 'METROPOLIS');
    assert.equal((await listExternalIdentifiers(pool, owner, created.data.patientId)).data.length, 1);
    const changedExternal = await updateExternalIdentifier(pool, owner, created.data.patientId, external.data.id,
      { externalIdentifier: 'MP-TEST-002', metadata: { corrected: true } }, request);
    assert.match(changedExternal.data.display_mask, /^MP••••02$/);

    await addPatientAddress(pool, owner, created.data.patientId, {
      addressLine1: '14 Private Lane', city: 'Nashik', state: 'Maharashtra', postalCode: '422001', isPrimary: true
    }, request);
    const addresses = await listPatientAddresses(pool, owner, created.data.patientId);
    assert.equal(addresses.data[0].addressLine1, '14 Private Lane');
    const storedAddress = await pool.query('SELECT address_ciphertext FROM patient_addresses WHERE patient_id=$1', [created.data.id]);
    assert.equal(storedAddress.rows[0].address_ciphertext.toString('utf8').includes('Private Lane'), false);
    const overrideAudit = await pool.query('SELECT count(*)::int AS count FROM audit_events WHERE organization_id=$1 AND action=\'patient.duplicate.override\'', [organizationId]);
    assert.equal(overrideAudit.rows[0].count, 1);

    const lead = await createLead(pool, owner, { firstName: 'Mira', mobile: '+919876500103', source: 'WHATSAPP', centreId }, request);
    await updateLead(pool, owner, lead.data.id, { status: 'CONTACTED' }, request);
    await addLeadActivity(pool, owner, lead.data.id, { activityType: 'CALL', note: 'Spoke to client; follow-up requested.' }, request);
    assert.equal((await getLeadDetail(pool, owner, lead.data.id)).data.status, 'CONTACTED');
    assert.equal((await listLeads(pool, owner, new URL('https://rudra.invalid/api/v1/leads?status=CONTACTED'))).data.length, 1);
    const converted = await convertLead(pool, owner, lead.data.id, {}, request);
    assert.equal(converted.data.status, 'CONVERTED');
    assert.ok((await patientTimeline(pool, owner, converted.data.patientId)).data.length > 0);
    const timeline = await pool.query('SELECT action FROM audit_events WHERE organization_id=$1 AND entity_type=\'LEAD\' AND entity_id=$2', [organizationId, lead.data.id]);
    assert.ok(timeline.rows.some((row) => row.action === 'lead.converted'));

    const scoped = { id: userId, organizationId, centres: [centreId], permissions: new Set(['patients.read']),
      permissionCentres: new Map([['patients.read',[centreId]]]) };
    await createPatient(pool, owner, { firstName: 'Centre B', mobile: '+919876500104', centreId: otherCentreId }, request);
    const scopedList = await listPatients(pool, scoped, new URL('https://rudra.invalid/api/v1/patients'));
    assert.ok(scopedList.data.every((patient) => patient.centreId === centreId));
    await assert.rejects(getPatientDetail(pool, scoped, (await pool.query('SELECT public_id FROM patients WHERE organization_id=$1 AND primary_centre_id=$2 ORDER BY created_at DESC LIMIT 1', [organizationId, otherCentreId])).rows[0].public_id),
      (error) => error instanceof HttpError && error.status === 403);

    const foreignPatient = (await pool.query(
      `INSERT INTO patients (organization_id,public_id,first_name,primary_centre_id,created_by)
       VALUES ($1,$2,'Foreign Patient',$3,$4) RETURNING public_id`,
      [foreignOrganizationId, `FOREIGN-PAT-${randomUUID()}`, foreignCentreId,
        (await pool.query('INSERT INTO users (organization_id,public_id,auth_subject,status) VALUES ($1,$2,$3,\'active\') RETURNING id',
          [foreignOrganizationId, `FOREIGN-STF-${randomUUID()}`, `foreign:${randomUUID()}`])).rows[0].id]
    )).rows[0].public_id;
    await assert.rejects(getPatientDetail(pool, owner, foreignPatient), (error) => error instanceof HttpError && error.status === 404);

    await assert.rejects(pool.query('UPDATE audit_events SET action=\'changed\' WHERE entity_type=\'LEAD\' AND entity_id=$1', [lead.data.id]));
    await assert.rejects(pool.query(
      `INSERT INTO patients (organization_id,public_id,first_name,primary_centre_id,created_by)
       VALUES ($1,$2,'Wrong Tenant',$3,$4)`,
      [organizationId, `RHC-PAT-X${randomUUID()}`, foreignCentreId, userId]
    ), (error) => error.code === '23503');

    const consent = (await pool.query(
      `INSERT INTO consents (organization_id,patient_id,consent_type,current_value,source,captured_at)
       VALUES ($1,$2,'SERVICE_WHATSAPP','GRANTED','INTEGRATION_TEST',now()) RETURNING id`,
      [organizationId, created.data.id]
    )).rows[0].id;
    const consentEvent = (await pool.query(
      `INSERT INTO consent_events (organization_id,patient_id,consent_id,consent_type,new_value,source)
       VALUES ($1,$2,$3,'SERVICE_WHATSAPP','GRANTED','INTEGRATION_TEST') RETURNING id`,
      [organizationId, created.data.id, consent]
    )).rows[0].id;
    await assert.rejects(pool.query('UPDATE consent_events SET new_value=\'WITHDRAWN\' WHERE id=$1', [consentEvent]));
    await assert.rejects(pool.query('DELETE FROM consent_events WHERE id=$1', [consentEvent]));

    const lost = await createLead(pool, owner, { firstName: 'Lost lead', source: 'WEBSITE', centreId }, request);
    assert.equal((await markLeadLost(pool, owner, lost.data.id, { reason: 'Client declined the service.' }, request)).data.status, 'LOST');
    assert.equal((await getLeadDetail(pool, owner, lost.data.id)).data.status, 'LOST');
  } finally {
    await pool.end();
  }
});
