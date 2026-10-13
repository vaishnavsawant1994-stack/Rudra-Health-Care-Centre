import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { HttpError } from '../src/authorization.mjs';
import {
  addFamilyMember, addPatientAddress, convertLead, createLead, createPatient,
  getPatientDetail, listPatientAddresses, listPatients, updatePatient, updateLead
} from '../src/records.mjs';

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
      '007_encrypt_patient_addresses.sql'
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
    const converted = await convertLead(pool, owner, lead.data.id, {}, request);
    assert.equal(converted.data.status, 'CONVERTED');
    const timeline = await pool.query('SELECT action FROM audit_events WHERE organization_id=$1 AND entity_type=\'LEAD\' AND entity_id=$2', [organizationId, lead.data.id]);
    assert.ok(timeline.rows.some((row) => row.action === 'lead.converted'));

    const scoped = { id: userId, organizationId, centres: [centreId], permissions: new Set(['patients.read']),
      permissionCentres: new Map([['patients.read',[centreId]]]) };
    await createPatient(pool, owner, { firstName: 'Centre B', mobile: '+919876500104', centreId: otherCentreId }, request);
    const scopedList = await listPatients(pool, scoped, new URL('https://rudra.invalid/api/v1/patients'));
    assert.ok(scopedList.data.every((patient) => patient.centreId === centreId));
    await assert.rejects(getPatientDetail(pool, scoped, (await pool.query('SELECT public_id FROM patients WHERE organization_id=$1 AND primary_centre_id=$2 ORDER BY created_at DESC LIMIT 1', [organizationId, otherCentreId])).rows[0].public_id),
      (error) => error instanceof HttpError && error.status === 403);

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
  } finally {
    await pool.end();
  }
});
