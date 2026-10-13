import { assertCentre, assertPermission, HttpError, parsePage, permissionCentres, validateLeadTransition, validateName } from './authorization.mjs';
import { decryptField, encryptField, hmacLookup, maskMobile, normalizeMobile } from './security.mjs';

const leadSources = new Set(['WALK_IN','PHONE','WHATSAPP','WEBSITE','INSTAGRAM','FACEBOOK','GOOGLE','DOCTOR','CORPORATE','PARTNER','CAMPAIGN','REFERRAL','OTHER']);
const leadStatuses = new Set(['NEW','CONTACTED','INTERESTED','FOLLOW_UP','CONVERTED','LOST']);
const relationships = new Set(['SPOUSE','MOTHER','FATHER','SON','DAUGHTER','CHILD','SIBLING','GUARDIAN','OTHER']);
const pick = (object, allowed) => Object.fromEntries(Object.entries(object || {}).filter(([key]) => allowed.includes(key)));
const canReadPatientCentre = (principal, centreId) => {
  const centres = permissionCentres(principal, 'patients.read');
  return centres === null || centres.includes(centreId);
};

export async function transaction(pool, callback) {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const result = await callback(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function nextPublicId(client, orgId, kind, prefix) {
  const result = await client.query(
    `INSERT INTO identifier_sequences (organization_id, identifier_kind, period_key, next_value)
     VALUES ($1, $2, '', 2)
     ON CONFLICT (organization_id, identifier_kind, period_key)
     DO UPDATE SET next_value = identifier_sequences.next_value + 1
     RETURNING next_value - 1 AS allocated`, [orgId, kind]
  );
  return `RHC-${prefix}-${String(result.rows[0].allocated).padStart(6, '0')}`;
}

async function lockMobileIdentity(client, organizationId, lookupHash) {
  if (!lookupHash) return;
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${organizationId}:${Buffer.from(lookupHash).toString('hex')}`]);
}

async function audit(client, principal, action, type, entityId, before, after, request) {
  await client.query(
    `INSERT INTO audit_events (organization_id, actor_user_id, actor_type, action, entity_type, entity_id,
       centre_id, before_json, after_json, ip_address, user_agent, request_id, outcome)
     VALUES ($1, $2, 'USER', $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11, 'SUCCESS')`,
    [principal.organizationId, principal.id, action, type, entityId, after?.centreId || before?.centreId || null,
      before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null,
      request.socket.remoteAddress?.replace(/^::ffff:/, '') || null,
      request.headers['user-agent'] || null, request.requestId]
  );
}

function mobileFields(value) {
  if (!value) return { ciphertext: null, hash: null, mask: null };
  const normalized = normalizeMobile(value);
  if (!/^\+?[0-9]{7,15}$/.test(normalized)) throw new HttpError(400, 'INVALID_MOBILE', 'Enter a valid mobile number.');
  return { ciphertext: encryptField(normalized), hash: hmacLookup(normalized), mask: maskMobile(normalized) };
}

function duplicateOverride(principal, body, centreId, matches = []) {
  if (body.allowDuplicate !== true) {
    throw new HttpError(409, 'POSSIBLE_DUPLICATE', 'A patient with this mobile number may already exist. Review any matching records you are permitted to access before continuing.', matches.length ? { matches } : undefined);
  }
  assertPermission(principal, 'patients.duplicate.override', centreId);
  if (typeof body.duplicateOverrideReason !== 'string' || body.duplicateOverrideReason.trim().length < 8 || body.duplicateOverrideReason.trim().length > 500) {
    throw new HttpError(400, 'OVERRIDE_REASON_REQUIRED', 'Add a reason of 8 to 500 characters to approve the possible duplicate.');
  }
  return body.duplicateOverrideReason.trim();
}

function emailFields(value) {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new HttpError(400, 'INVALID_EMAIL', 'Enter a valid email address.');
  return encryptField(normalized);
}

function toPatient(row, principal) {
  const canReadContact = principal.permissions.has('patients.contact.read');
  return {
    id: row.id, patientId: row.public_id, firstName: row.first_name,
    middleName: row.middle_name, lastName: row.last_name,
    dateOfBirth: row.date_of_birth, gender: row.gender,
    mobile: canReadContact ? decryptField(row.mobile_ciphertext) : row.mobile_mask,
    alternateMobile: canReadContact ? decryptField(row.alternate_mobile_ciphertext) : null,
    email: canReadContact ? decryptField(row.email_ciphertext) : null, preferredLanguage: row.preferred_language,
    centreId: row.primary_centre_id, referralSource: row.referral_source,
    referredDoctorId: row.referred_doctor_id, corporateId: row.corporate_id,
    status: row.status, primaryAccountHolder: row.is_primary_account_holder,
    lastVisitAt: row.last_visit_at, createdAt: row.created_at, updatedAt: row.updated_at,
    version: row.version
  };
}

const patientSelect = `SELECT id, public_id, first_name, middle_name, last_name, date_of_birth, gender,
  mobile_ciphertext, alternate_mobile_ciphertext, email_ciphertext, preferred_language, primary_centre_id,
  referral_source, referred_doctor_id, corporate_id, status, is_primary_account_holder, last_visit_at,
  created_at, updated_at, version FROM patients`;

async function getPatient(client, principal, id, lock = false) {
  const result = await client.query(`${patientSelect} WHERE organization_id = $1 AND (id::text = $2 OR public_id = $2) AND deleted_at IS NULL ${lock ? 'FOR UPDATE' : ''}`,
    [principal.organizationId, id]);
  const row = result.rows[0];
  if (!row) throw new HttpError(404, 'PATIENT_NOT_FOUND', 'Patient was not found.');
  assertCentre(principal, row.primary_centre_id);
  assertPermission(principal, 'patients.read', row.primary_centre_id);
  return row;
}

export async function listPatients(pool, principal, url) {
  assertPermission(principal, 'patients.read');
  const { limit, offset } = parsePage(url);
  const search = (url.searchParams.get('q') || '').trim();
  if (search.length > 120) throw new HttpError(400, 'SEARCH_TOO_LONG', 'Search must be 120 characters or fewer.');
  const centreId = url.searchParams.get('centreId');
  if (centreId) { assertCentre(principal, centreId); assertPermission(principal, 'patients.read', centreId); }
  const readableCentres = permissionCentres(principal, 'patients.read');
  const organizationWide = readableCentres === null;
  const scopeCentres = organizationWide ? [] : readableCentres;
  const mobile = /^\+?[0-9\s().-]+$/.test(search) && search.replace(/\D/g, '').length >= 7 ? hmacLookup(normalizeMobile(search)) : null;
  const scopeSql = organizationWide ? '' : 'AND primary_centre_id = ANY($5::uuid[])';
  const rowParams = centreId
    ? [principal.organizationId, `%${search}%`, mobile, limit, offset, centreId]
    : organizationWide
      ? [principal.organizationId, `%${search}%`, mobile, limit, offset]
      : [principal.organizationId, `%${search}%`, mobile, limit, scopeCentres, offset];
  const result = await pool.query(
    `${patientSelect} WHERE organization_id = $1 AND deleted_at IS NULL
       AND ($2 = '%%' OR public_id ILIKE $2 OR first_name ILIKE $2 OR last_name ILIKE $2 OR (mobile_lookup_hash = $3 AND $3 IS NOT NULL))
       ${centreId ? 'AND primary_centre_id = $6' : scopeSql}
     ORDER BY created_at DESC LIMIT $4 OFFSET $${centreId || organizationWide ? 5 : 6}`,
    rowParams
  );
  const countParams = centreId ? [principal.organizationId, `%${search}%`, mobile, centreId]
    : organizationWide ? [principal.organizationId, `%${search}%`, mobile]
      : [principal.organizationId, `%${search}%`, mobile, scopeCentres];
  const count = await pool.query(
    `SELECT count(*)::int AS count FROM patients WHERE organization_id = $1 AND deleted_at IS NULL
      AND ($2 = '%%' OR public_id ILIKE $2 OR first_name ILIKE $2 OR last_name ILIKE $2 OR (mobile_lookup_hash = $3 AND $3 IS NOT NULL))
      ${centreId ? 'AND primary_centre_id = $4' : organizationWide ? '' : 'AND primary_centre_id = ANY($4::uuid[])'}`,
    countParams
  );
  return { data: result.rows.map((row) => toPatient(row, principal)), meta: { limit, offset, total: count.rows[0].count } };
}

export async function createPatient(pool, principal, body, request) {
  assertPermission(principal, 'patients.create');
  const firstName = validateName(body.firstName);
  const mobile = mobileFields(body.mobile);
  const centreId = body.centreId || principal.primaryCentreId;
  if (!centreId) throw new HttpError(400, 'CENTRE_REQUIRED', 'Select an assigned centre before creating a patient.');
  assertCentre(principal, centreId);
  assertPermission(principal, 'patients.create', centreId);
  return transaction(pool, async (client) => {
    let overrideReason = null;
    if (mobile.hash) {
      await lockMobileIdentity(client, principal.organizationId, mobile.hash);
      const duplicate = await client.query(
        `SELECT id, public_id, mobile_mask, primary_centre_id FROM patients WHERE organization_id = $1 AND mobile_lookup_hash = $2 AND deleted_at IS NULL AND status <> 'MERGED' LIMIT 20`,
        [principal.organizationId, mobile.hash]
      );
      if (duplicate.rowCount) {
        const matches = duplicate.rows.filter((row) => canReadPatientCentre(principal, row.primary_centre_id))
          .map(({ id, public_id, mobile_mask }) => ({ id, patientId: public_id, mobile: mobile_mask }));
        overrideReason = duplicateOverride(principal, body, centreId, matches);
      }
    }
    const publicId = await nextPublicId(client, principal.organizationId, 'PATIENT', 'PAT');
    const values = {
      first_name: firstName, middle_name: body.middleName?.trim() || null,
      last_name: body.lastName?.trim() || null,
      date_of_birth: body.dateOfBirth || null, gender: body.gender || null,
      mobile_ciphertext: mobile.ciphertext, mobile_lookup_hash: mobile.hash, mobile_mask: mobile.mask,
      alternate_mobile_ciphertext: body.alternateMobile ? mobileFields(body.alternateMobile).ciphertext : null,
      email_ciphertext: emailFields(body.email), preferred_language: body.preferredLanguage || null,
      referral_source: body.referralSource || null, primary_centre_id: centreId,
      is_primary_account_holder: Boolean(body.primaryAccountHolder)
    };
    if (values.date_of_birth && !/^\d{4}-\d{2}-\d{2}$/.test(values.date_of_birth)) throw new HttpError(400, 'INVALID_DATE', 'Date of birth must use YYYY-MM-DD.');
    if (values.gender && !['FEMALE','MALE','OTHER','PREFER_NOT_TO_SAY','UNKNOWN'].includes(values.gender)) throw new HttpError(400, 'INVALID_GENDER', 'Select a supported gender value.');
    const result = await client.query(
      `INSERT INTO patients (organization_id, public_id, first_name, middle_name, last_name, date_of_birth, gender,
        mobile_ciphertext, mobile_lookup_hash, mobile_mask, alternate_mobile_ciphertext, email_ciphertext,
        preferred_language, referral_source, primary_centre_id, is_primary_account_holder, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17) RETURNING id`,
      [principal.organizationId, publicId, values.first_name, values.middle_name, values.last_name, values.date_of_birth,
        values.gender, values.mobile_ciphertext, values.mobile_lookup_hash, values.mobile_mask, values.alternate_mobile_ciphertext,
        values.email_ciphertext, values.preferred_language, values.referral_source, values.primary_centre_id,
        values.is_primary_account_holder, principal.id]
    );
    const row = (await client.query(`${patientSelect} WHERE id=$1 AND organization_id=$2`, [result.rows[0].id, principal.organizationId])).rows[0];
    await audit(client, principal, 'patient.created', 'PATIENT', row.id, null, { patientId: row.public_id, centreId }, request);
    if (overrideReason) await audit(client, principal, 'patient.duplicate.override', 'PATIENT', row.id, null, { reason: overrideReason, centreId }, request);
    return { data: toPatient(row, principal) };
  });
}

export async function getPatientDetail(pool, principal, id) {
  assertPermission(principal, 'patients.read');
  const row = await getPatient(pool, principal, id);
  return { data: toPatient(row, principal) };
}

export async function updatePatient(pool, principal, id, body, request) {
  assertPermission(principal, 'patients.update');
  const updates = pick(body, ['firstName','middleName','lastName','dateOfBirth','gender','mobile','alternateMobile','email','preferredLanguage','referralSource','centreId','primaryAccountHolder']);
  if (!Object.keys(updates).length) throw new HttpError(400, 'EMPTY_UPDATE', 'Provide at least one supported field to update.');
  return transaction(pool, async (client) => {
    const before = await getPatient(client, principal, id, true);
    assertPermission(principal, 'patients.update', before.primary_centre_id);
    const nextCentre = updates.centreId || before.primary_centre_id;
    assertCentre(principal, nextCentre);
    assertPermission(principal, 'patients.update', nextCentre);
    let overrideReason = null;
    if (updates.mobile) {
      const mobile = mobileFields(updates.mobile);
      await lockMobileIdentity(client, principal.organizationId, mobile.hash);
      const duplicate = await client.query(`SELECT public_id FROM patients WHERE organization_id=$1 AND mobile_lookup_hash=$2 AND id<>$3 AND deleted_at IS NULL LIMIT 1`, [principal.organizationId, mobile.hash, before.id]);
      if (duplicate.rowCount) {
        overrideReason = duplicateOverride(principal, body, before.primary_centre_id);
        assertPermission(principal, 'patients.duplicate.override', nextCentre);
      }
      updates.mobileCiphertext = mobile.ciphertext; updates.mobileHash = mobile.hash; updates.mobileMask = mobile.mask;
    }
    if (updates.alternateMobile) updates.alternateMobileCiphertext = mobileFields(updates.alternateMobile).ciphertext;
    if (updates.email) updates.emailCiphertext = emailFields(updates.email);
    const columns = {
      firstName: ['first_name', (v) => validateName(v, 'firstName')], middleName: ['middle_name', (v) => v?.trim() || null],
      lastName: ['last_name', (v) => v?.trim() || null], dateOfBirth: ['date_of_birth', (v) => v || null],
      gender: ['gender', (v) => v || null], preferredLanguage: ['preferred_language', (v) => v || null],
      referralSource: ['referral_source', (v) => v || null], centreId: ['primary_centre_id', (v) => v],
      primaryAccountHolder: ['is_primary_account_holder', Boolean],
      mobileCiphertext: ['mobile_ciphertext', (v) => v], mobileHash: ['mobile_lookup_hash', (v) => v], mobileMask: ['mobile_mask', (v) => v],
      alternateMobileCiphertext: ['alternate_mobile_ciphertext', (v) => v], emailCiphertext: ['email_ciphertext', (v) => v]
    };
    const setters = []; const params = [principal.organizationId, before.id];
    for (const [key, value] of Object.entries(updates)) {
      const entry = columns[key]; if (!entry) continue;
      const [column, transform] = entry; params.push(transform(value)); setters.push(`${column} = $${params.length}`);
    }
    params.push(principal.id); setters.push(`updated_by = $${params.length}`, 'updated_at = now()', 'version = version + 1');
    await client.query(`UPDATE patients SET ${setters.join(', ')} WHERE organization_id=$1 AND id=$2`, params);
    const after = await getPatient(client, principal, before.id);
    await audit(client, principal, 'patient.updated', 'PATIENT', before.id, { patientId: before.public_id, centreId: before.primary_centre_id, version: before.version }, { patientId: after.public_id, centreId: after.primary_centre_id, version: after.version }, request);
    if (overrideReason) await audit(client, principal, 'patient.duplicate.override', 'PATIENT', after.id, null, { reason: overrideReason, centreId: after.primary_centre_id }, request);
    return { data: toPatient(after, principal) };
  });
}

export async function patientTimeline(pool, principal, id) {
  assertPermission(principal, 'patients.read');
  const patient = await getPatient(pool, principal, id);
  const [auditRows, leadRows] = await Promise.all([
    pool.query(`SELECT id, action, actor_user_id, created_at, outcome, after_json FROM audit_events
      WHERE organization_id=$1 AND entity_type='PATIENT' AND entity_id=$2 ORDER BY created_at DESC LIMIT 100`, [principal.organizationId, patient.id]),
    pool.query(`SELECT la.id, la.activity_type AS action, la.performed_by AS actor_user_id, la.created_at, 'SUCCESS' AS outcome
      FROM lead_activities la JOIN leads l ON l.id=la.lead_id
      WHERE l.organization_id=$1 AND l.converted_patient_id=$2 ORDER BY la.created_at DESC LIMIT 100`, [principal.organizationId, patient.id])
  ]);
  return { data: [...auditRows.rows, ...leadRows.rows].sort((a,b) => new Date(b.created_at)-new Date(a.created_at)).slice(0, 100) };
}

export async function addPatientAddress(pool, principal, id, body, request) {
  assertPermission(principal, 'patients.update');
  assertPermission(principal, 'patients.address.read');
  const patient = await getPatient(pool, principal, id);
  assertPermission(principal, 'patients.update', patient.primary_centre_id);
  assertPermission(principal, 'patients.address.read', patient.primary_centre_id);
  const required = ['addressLine1','city','state','postalCode'];
  if (required.some((field) => typeof body[field] !== 'string' || !body[field].trim())) throw new HttpError(400, 'ADDRESS_REQUIRED', 'Address, city, state and postal code are required.');
  return transaction(pool, async (client) => {
    if (body.isPrimary) await client.query('UPDATE patient_addresses SET is_primary=false WHERE organization_id=$1 AND patient_id=$2 AND is_primary=true', [principal.organizationId, patient.id]);
    const result = await client.query(
      `INSERT INTO patient_addresses (organization_id, patient_id, address_ciphertext, is_primary)
       VALUES ($1,$2,$3,$4) RETURNING id, address_ciphertext, is_primary, created_at, updated_at`,
      [principal.organizationId, patient.id, encryptField(JSON.stringify({ label: body.label || 'HOME', addressLine1: body.addressLine1.trim(),
        addressLine2: body.addressLine2 || null, landmark: body.landmark || null, city: body.city.trim(), state: body.state.trim(),
        postalCode: body.postalCode.trim(), country: body.country || 'India', latitude: body.latitude ?? null, longitude: body.longitude ?? null })), Boolean(body.isPrimary)]
    );
    await audit(client, principal, 'patient.address.created', 'PATIENT', patient.id, null, { addressId: result.rows[0].id, centreId: patient.primary_centre_id }, request);
    return { data: { ...result.rows[0], ...JSON.parse(decryptField(result.rows[0].address_ciphertext || null) || '{}') } };
  });
}

export async function listPatientAddresses(pool, principal, id) {
  assertPermission(principal, 'patients.read'); assertPermission(principal, 'patients.address.read'); const patient = await getPatient(pool, principal, id);
  assertPermission(principal, 'patients.address.read', patient.primary_centre_id);
  const result = await pool.query('SELECT id, address_ciphertext, is_primary, created_at, updated_at FROM patient_addresses WHERE organization_id=$1 AND patient_id=$2 ORDER BY is_primary DESC, created_at', [principal.organizationId, patient.id]);
  return { data: result.rows.map((row) => ({ id: row.id, isPrimary: row.is_primary, createdAt: row.created_at,
    updatedAt: row.updated_at, ...JSON.parse(decryptField(row.address_ciphertext) || '{}') })) };
}

export async function addFamilyMember(pool, principal, id, body, request) {
  assertPermission(principal, 'patients.update');
  if (!relationships.has(body.relationshipType)) throw new HttpError(400, 'INVALID_RELATIONSHIP', 'Select a supported family relationship.');
  return transaction(pool, async (client) => {
    const patient = await getPatient(client, principal, id, true);
    assertPermission(principal, 'patients.update', patient.primary_centre_id);
    const related = await getPatient(client, principal, body.relatedPatientId);
    const result = await client.query(
      `INSERT INTO family_relationships (organization_id, patient_id, related_patient_id, relationship_type, is_primary_contact, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [principal.organizationId, patient.id, related.id, body.relationshipType, Boolean(body.isPrimaryContact), principal.id]
    );
    await audit(client, principal, 'patient.family.linked', 'PATIENT', patient.id, null, { relationshipId: result.rows[0].id, relatedPatientId: related.public_id, centreId: patient.primary_centre_id }, request);
    return { data: { relationshipId: result.rows[0].id, patientId: patient.public_id, relatedPatientId: related.public_id, relationshipType: body.relationshipType } };
  });
}

export async function listFamily(pool, principal, id) {
  assertPermission(principal, 'patients.read'); const patient = await getPatient(pool, principal, id);
  const result = await pool.query(
    `SELECT fr.id AS relationship_id, fr.relationship_type, fr.is_primary_contact, fr.created_at,
       p.id, p.public_id, p.first_name, p.last_name, p.mobile_mask
     FROM family_relationships fr JOIN patients p ON p.id=fr.related_patient_id
     WHERE fr.organization_id=$1 AND fr.patient_id=$2 AND fr.valid_until IS NULL ORDER BY fr.created_at`,
    [principal.organizationId, patient.id]
  );
  return { data: result.rows };
}

export async function endFamilyRelationship(pool, principal, id, relationshipId, request) {
  assertPermission(principal, 'patients.update');
  return transaction(pool, async (client) => {
    const patient = await getPatient(client, principal, id);
    assertPermission(principal, 'patients.update', patient.primary_centre_id);
    const result = await client.query(`UPDATE family_relationships SET valid_until=CURRENT_DATE
      WHERE organization_id=$1 AND patient_id=$2 AND id=$3 AND valid_until IS NULL RETURNING id`, [principal.organizationId, patient.id, relationshipId]);
    if (!result.rowCount) throw new HttpError(404, 'RELATIONSHIP_NOT_FOUND', 'Family relationship was not found.');
    await audit(client, principal, 'patient.family.ended', 'PATIENT', patient.id, { relationshipId }, { relationshipId, ended: true, centreId: patient.primary_centre_id }, request);
    return { data: { relationshipId, ended: true } };
  });
}

export async function addExternalIdentifier(pool, principal, id, body, request) {
  assertPermission(principal, 'patients.update'); const patient = await getPatient(pool, principal, id);
  assertPermission(principal, 'patients.update', patient.primary_centre_id);
  if (!body.provider || !body.identifierType || !body.externalIdentifier) throw new HttpError(400, 'IDENTIFIER_REQUIRED', 'Provider, identifier type and external identifier are required.');
  const normalized = String(body.externalIdentifier).trim();
  const cipher = encryptField(normalized); const hash = hmacLookup(`${body.provider.toUpperCase()}:${body.identifierType.toUpperCase()}:${normalized}`);
  return transaction(pool, async (client) => {
    const result = await client.query(
      `INSERT INTO patient_external_identifiers (organization_id, patient_id, provider, identifier_type, external_identifier_ciphertext, external_identifier_hash, display_mask, metadata_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING id, provider, identifier_type, display_mask, created_at`,
      [principal.organizationId, patient.id, body.provider.toUpperCase(), body.identifierType.toUpperCase(), cipher, hash,
       `${normalized.slice(0,2)}••••${normalized.slice(-2)}`, JSON.stringify(body.metadata || {})]
    );
    await audit(client, principal, 'patient.external_identifier.created', 'PATIENT', patient.id, null, { identifierId: result.rows[0].id, provider: result.rows[0].provider, centreId: patient.primary_centre_id }, request);
    return { data: result.rows[0] };
  });
}

export async function listExternalIdentifiers(pool, principal, id) {
  assertPermission(principal, 'patients.read'); const patient = await getPatient(pool, principal, id);
  const result = await pool.query(
    `SELECT id, provider, identifier_type, display_mask, metadata_json, verified_at, created_at, updated_at
       FROM patient_external_identifiers WHERE organization_id=$1 AND patient_id=$2 ORDER BY created_at DESC`,
    [principal.organizationId, patient.id]
  );
  return { data: result.rows };
}

export async function updateExternalIdentifier(pool, principal, id, externalId, body, request) {
  assertPermission(principal, 'patients.update');
  const patient = await getPatient(pool, principal, id);
  assertPermission(principal, 'patients.update', patient.primary_centre_id);
  if (typeof body.externalIdentifier !== 'string' || !body.externalIdentifier.trim()) throw new HttpError(400, 'IDENTIFIER_REQUIRED', 'Enter the external identifier.');
  const normalized = body.externalIdentifier.trim();
  return transaction(pool, async (client) => {
    const current = await client.query('SELECT provider, identifier_type FROM patient_external_identifiers WHERE organization_id=$1 AND patient_id=$2 AND id=$3 FOR UPDATE', [principal.organizationId, patient.id, externalId]);
    if (!current.rowCount) throw new HttpError(404, 'EXTERNAL_IDENTIFIER_NOT_FOUND', 'External identifier was not found.');
    const { provider, identifier_type: identifierType } = current.rows[0];
    const result = await client.query(
      `UPDATE patient_external_identifiers SET external_identifier_ciphertext=$4, external_identifier_hash=$5,
         display_mask=$6, metadata_json=$7::jsonb, updated_at=now()
       WHERE organization_id=$1 AND patient_id=$2 AND id=$3
       RETURNING id, provider, identifier_type, display_mask, metadata_json, verified_at, updated_at`,
      [principal.organizationId, patient.id, externalId, encryptField(normalized),
        hmacLookup(`${provider}:${identifierType}:${normalized}`), `${normalized.slice(0,2)}••••${normalized.slice(-2)}`, JSON.stringify(body.metadata || {})]
    );
    await audit(client, principal, 'patient.external_identifier.updated', 'PATIENT', patient.id, null,
      { identifierId: externalId, provider, centreId: patient.primary_centre_id }, request);
    return { data: result.rows[0] };
  });
}

export async function listLeads(pool, principal, url) {
  assertPermission(principal, 'leads.read'); const { limit, offset } = parsePage(url);
  const status = url.searchParams.get('status'); if (status && !leadStatuses.has(status)) throw new HttpError(400, 'INVALID_STATUS', 'Select a supported lead status.');
  const centreId = url.searchParams.get('centreId');
  if (centreId) { assertCentre(principal, centreId); assertPermission(principal, 'leads.read', centreId); }
  const readableCentres = permissionCentres(principal, 'leads.read');
  const organizationWide = readableCentres === null;
  const centreClause = organizationWide ? '' : 'AND centre_id = ANY($4::uuid[])';
  const result = await pool.query(
    `SELECT id, public_id, centre_id, first_name, last_name, mobile_mask, source, interested_service, assigned_staff_id, status, priority, next_follow_up_at, created_at
      FROM leads WHERE organization_id=$1 AND ($2::text IS NULL OR status=$2) AND ($3::uuid IS NULL OR centre_id=$3)
      ${centreId ? '' : centreClause} ORDER BY next_follow_up_at NULLS LAST, created_at DESC LIMIT $${centreId || organizationWide ? 4 : 5} OFFSET $${centreId || organizationWide ? 5 : 6}`,
    centreId ? [principal.organizationId, status || null, centreId, limit, offset]
      : organizationWide ? [principal.organizationId, status || null, null, limit, offset]
      : [principal.organizationId, status || null, null, readableCentres, limit, offset]
  );
  return { data: result.rows, meta: { limit, offset } };
}

export async function createLead(pool, principal, body, request) {
  assertPermission(principal, 'leads.create');
  const source = String(body.source || '').toUpperCase(); if (!leadSources.has(source)) throw new HttpError(400, 'INVALID_SOURCE', 'Select a supported lead source.');
  const centreId = body.centreId || principal.primaryCentreId; if (centreId) assertCentre(principal, centreId);
  if (!centreId) throw new HttpError(400, 'CENTRE_REQUIRED', 'Select an assigned centre before creating a lead.');
  assertPermission(principal, 'leads.create', centreId);
  const mobile = mobileFields(body.mobile); const email = emailFields(body.email);
  return transaction(pool, async (client) => {
    const publicId = await nextPublicId(client, principal.organizationId, 'LEAD', 'LEAD');
    const result = await client.query(
      `INSERT INTO leads (organization_id, public_id, centre_id, first_name, last_name, mobile_ciphertext, mobile_lookup_hash, mobile_mask,
        email_ciphertext, source, interested_service, assigned_staff_id, status, priority, next_follow_up_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'NEW',$13,$14) RETURNING id, public_id, centre_id, first_name, last_name, mobile_mask, source, status, priority, created_at`,
      [principal.organizationId, publicId, centreId, body.firstName?.trim() || null, body.lastName?.trim() || null,
        mobile.ciphertext, mobile.hash, mobile.mask, email, source, body.interestedService || null,
        body.assignedStaffId || principal.id, body.priority || 'NORMAL', body.nextFollowUpAt || null]
    );
    const lead = result.rows[0];
    await client.query('INSERT INTO lead_activities (organization_id, lead_id, activity_type, note, performed_by) VALUES ($1,$2,$3,$4,$5)',
      [principal.organizationId, lead.id, 'CREATED', 'Lead created', principal.id]);
    await audit(client, principal, 'lead.created', 'LEAD', lead.id, null, { leadId: lead.public_id, centreId }, request);
    return { data: lead };
  });
}

async function getLead(client, principal, id, lock = false) {
  const result = await client.query(`SELECT * FROM leads WHERE organization_id=$1 AND (id::text=$2 OR public_id=$2) ${lock ? 'FOR UPDATE' : ''}`, [principal.organizationId, id]);
  const lead = result.rows[0]; if (!lead) throw new HttpError(404, 'LEAD_NOT_FOUND', 'Lead was not found.');
  assertCentre(principal, lead.centre_id); assertPermission(principal, 'leads.read', lead.centre_id); return lead;
}

export async function getLeadDetail(pool, principal, id) {
  assertPermission(principal, 'leads.read');
  const lead = await getLead(pool, principal, id);
  const activities = await pool.query('SELECT id, activity_type, note, performed_by, created_at FROM lead_activities WHERE organization_id=$1 AND lead_id=$2 ORDER BY created_at DESC', [principal.organizationId, lead.id]);
  return { data: { id: lead.id, leadId: lead.public_id, firstName: lead.first_name, lastName: lead.last_name,
    mobile: decryptField(lead.mobile_ciphertext), email: decryptField(lead.email_ciphertext), source: lead.source,
    interestedService: lead.interested_service, assignedStaffId: lead.assigned_staff_id, status: lead.status,
    priority: lead.priority, nextFollowUpAt: lead.next_follow_up_at, centreId: lead.centre_id, activities: activities.rows } };
}

export async function updateLead(pool, principal, id, body, request) {
  assertPermission(principal, 'leads.update');
  return transaction(pool, async (client) => {
    const before = await getLead(client, principal, id, true);
    assertPermission(principal, 'leads.update', before.centre_id);
    const updates = pick(body, ['firstName','lastName','source','interestedService','assignedStaffId','status','priority','nextFollowUpAt','centreId']);
    if (!Object.keys(updates).length) throw new HttpError(400, 'EMPTY_UPDATE', 'Provide at least one supported field to update.');
    if (updates.source && !leadSources.has(String(updates.source).toUpperCase())) throw new HttpError(400, 'INVALID_SOURCE', 'Select a supported lead source.');
    if (updates.status) {
      if (!leadStatuses.has(updates.status)) throw new HttpError(400, 'INVALID_STATUS', 'Select a supported lead status.');
      if (updates.status === 'CONVERTED' || updates.status === 'LOST') throw new HttpError(400, 'USE_STATUS_ACTION', 'Use the dedicated convert or mark-lost action for this status.');
      validateLeadTransition(before.status, updates.status);
    }
    const map = { firstName:'first_name', lastName:'last_name', source:'source', interestedService:'interested_service', assignedStaffId:'assigned_staff_id', status:'status', priority:'priority', nextFollowUpAt:'next_follow_up_at', centreId:'centre_id' };
    const params = [principal.organizationId, before.id]; const sets = [];
    for (const [key, value] of Object.entries(updates)) { params.push(key === 'source' ? String(value).toUpperCase() : value || null); sets.push(`${map[key]}=$${params.length}`); }
    if (updates.centreId) {
      assertCentre(principal, updates.centreId);
      assertPermission(principal, 'leads.update', updates.centreId);
    } else if (Object.hasOwn(updates, 'centreId')) {
      throw new HttpError(400, 'CENTRE_REQUIRED', 'A lead must remain assigned to a centre.');
    }
    sets.push('updated_at=now()', 'version=version+1');
    await client.query(`UPDATE leads SET ${sets.join(', ')} WHERE organization_id=$1 AND id=$2`, params);
    const after = await getLead(client, principal, before.id);
    if (updates.status && updates.status !== before.status) await client.query('INSERT INTO lead_activities (organization_id, lead_id, activity_type, note, performed_by) VALUES ($1,$2,$3,$4,$5)', [principal.organizationId, before.id, 'STATUS_CHANGED', `${before.status} → ${after.status}`, principal.id]);
    await audit(client, principal, 'lead.updated', 'LEAD', before.id, { leadId: before.public_id, status: before.status, centreId: before.centre_id }, { leadId: after.public_id, status: after.status, centreId: after.centre_id }, request);
    return { data: { id: after.id, leadId: after.public_id, status: after.status, centreId: after.centre_id, version: after.version } };
  });
}

export async function addLeadActivity(pool, principal, id, body, request) {
  assertPermission(principal, 'leads.update');
  if (typeof body.note !== 'string' || !body.note.trim() || body.note.length > 4000) throw new HttpError(400, 'NOTE_REQUIRED', 'Enter a note of 1 to 4,000 characters.');
  return transaction(pool, async (client) => {
    const lead = await getLead(client, principal, id, true);
    assertPermission(principal, 'leads.update', lead.centre_id);
    const result = await client.query('INSERT INTO lead_activities (organization_id, lead_id, activity_type, note, performed_by) VALUES ($1,$2,$3,$4,$5) RETURNING id, activity_type, note, performed_by, created_at',
      [principal.organizationId, lead.id, body.activityType || 'NOTE', body.note.trim(), principal.id]);
    await audit(client, principal, 'lead.activity.added', 'LEAD', lead.id, null, { activityId: result.rows[0].id, centreId: lead.centre_id }, request);
    return { data: result.rows[0] };
  });
}

export async function convertLead(pool, principal, id, body, request) {
  return transaction(pool, async (client) => {
    const lead = await getLead(client, principal, id, true);
    assertPermission(principal, 'leads.convert', lead.centre_id);
    if (lead.status === 'CONVERTED') throw new HttpError(409, 'LEAD_ALREADY_CONVERTED', 'This lead has already been converted.');
    let patientId = body.patientId;
    let patientPublicId;
    let duplicateOverrideReason = null;
    if (patientId) {
      const patient = await getPatient(client, principal, patientId);
      patientId = patient.id;
      patientPublicId = patient.public_id;
    } else {
      assertPermission(principal, 'patients.create', lead.centre_id);
      if (lead.mobile_lookup_hash) {
        await lockMobileIdentity(client, principal.organizationId, lead.mobile_lookup_hash);
        const duplicate = await client.query('SELECT id, public_id, primary_centre_id FROM patients WHERE organization_id=$1 AND mobile_lookup_hash=$2 AND deleted_at IS NULL LIMIT 20', [principal.organizationId, lead.mobile_lookup_hash]);
        if (duplicate.rowCount) {
          const matches = duplicate.rows.filter((row) => canReadPatientCentre(principal, row.primary_centre_id)).map(({id,public_id})=>({id,patientId:public_id}));
          if (body.allowDuplicate !== true) throw new HttpError(409, 'POSSIBLE_DUPLICATE', 'A patient with this mobile number may already exist. Select a matching patient you are permitted to access or review the record with an administrator.', matches.length ? { matches } : undefined);
          assertPermission(principal, 'patients.duplicate.override', lead.centre_id);
          if (typeof body.duplicateOverrideReason !== 'string' || body.duplicateOverrideReason.trim().length < 8 || body.duplicateOverrideReason.trim().length > 500) throw new HttpError(400, 'OVERRIDE_REASON_REQUIRED', 'Add a reason of 8 to 500 characters to approve the possible duplicate.');
          duplicateOverrideReason = body.duplicateOverrideReason.trim();
        }
      }
      const publicId = await nextPublicId(client, principal.organizationId, 'PATIENT', 'PAT');
      const created = await client.query(
        `INSERT INTO patients (organization_id, public_id, first_name, last_name, mobile_ciphertext, mobile_lookup_hash, mobile_mask,
          email_ciphertext, primary_centre_id, referral_source, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) RETURNING id`,
        [principal.organizationId, publicId, lead.first_name || 'New', lead.last_name, lead.mobile_ciphertext, lead.mobile_lookup_hash,
          lead.mobile_mask, lead.email_ciphertext, lead.centre_id, lead.source, principal.id]
      );
      patientId = created.rows[0].id;
      patientPublicId = publicId;
    }
    await client.query('UPDATE leads SET status=\'CONVERTED\', converted_patient_id=$3, updated_at=now(), version=version+1 WHERE organization_id=$1 AND id=$2', [principal.organizationId, lead.id, patientId]);
    await client.query('INSERT INTO lead_activities (organization_id, lead_id, activity_type, note, performed_by) VALUES ($1,$2,\'CONVERTED\',$3,$4)', [principal.organizationId, lead.id, `Converted to patient ${patientId}`, principal.id]);
    await audit(client, principal, 'lead.converted', 'LEAD', lead.id, { leadId: lead.public_id, status: lead.status, centreId: lead.centre_id }, { leadId: lead.public_id, status: 'CONVERTED', patientId: patientPublicId, centreId: lead.centre_id }, request);
    if (duplicateOverrideReason) await audit(client, principal, 'patient.duplicate.override', 'PATIENT', patientId, null, { reason: duplicateOverrideReason, centreId: lead.centre_id }, request);
    return { data: { leadId: lead.public_id, patientId: patientPublicId, patientInternalId: patientId, status: 'CONVERTED' } };
  });
}

export async function markLeadLost(pool, principal, id, body, request) {
  if (typeof body.reason !== 'string' || !body.reason.trim()) throw new HttpError(400, 'LOST_REASON_REQUIRED', 'Add a reason before marking this lead lost.');
  return transaction(pool, async (client) => {
    const lead = await getLead(client, principal, id, true);
    assertPermission(principal, 'leads.update', lead.centre_id);
    validateLeadTransition(lead.status, 'LOST');
    await client.query(`UPDATE leads SET status='LOST', lost_reason=$3, updated_at=now(), version=version+1 WHERE organization_id=$1 AND id=$2`,
      [principal.organizationId, lead.id, body.reason.trim()]);
    await client.query('INSERT INTO lead_activities (organization_id, lead_id, activity_type, note, performed_by) VALUES ($1,$2,\'MARKED_LOST\',$3,$4)',
      [principal.organizationId, lead.id, body.reason.trim(), principal.id]);
    await audit(client, principal, 'lead.marked_lost', 'LEAD', lead.id, { leadId: lead.public_id, status: lead.status, centreId: lead.centre_id }, { leadId: lead.public_id, status: 'LOST', centreId: lead.centre_id }, request);
    return { data: { leadId: lead.public_id, status: 'LOST' } };
  });
}
