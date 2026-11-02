import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { centrePublicProfiles, centres, organizations } from "@/db/schema";
import { decryptCentrePublicProfile } from "@/server/centre-public-profile";
import { listPublicCatalogueCentres } from "@/server/public-catalogue";

/** Public centre directory: catalogue-listed centres plus active centres with an explicitly published profile. */
export async function listPublicCentres() {
  const catalogueCentres = await listPublicCatalogueCentres();
  const rows = await getDb().select({
    id: centres.id,
    organizationId: centres.organizationId,
    code: centres.code,
    profileCiphertext: centrePublicProfiles.profileCiphertext,
  }).from(centres)
    .innerJoin(organizations, eq(organizations.id, centres.organizationId))
    .innerJoin(centrePublicProfiles, and(
      eq(centrePublicProfiles.centreId, centres.id),
      eq(centrePublicProfiles.organizationId, centres.organizationId),
      eq(centrePublicProfiles.published, true),
    ))
    .where(and(eq(centres.status, "ACTIVE"), eq(organizations.status, "ACTIVE")))
    .orderBy(asc(centres.name), asc(centres.code));

  const publishedProfileCentres = rows.map(({ organizationId, profileCiphertext, ...centre }) => {
    const profile = decryptCentrePublicProfile(profileCiphertext, organizationId, centre.id);
    return {
      id: centre.id,
      code: centre.code,
      name: profile.displayName,
      publicProfile: { address: profile.address, phone: profile.phone, email: profile.email, serviceArea: profile.serviceArea, openingHours: profile.openingHours },
    };
  });

  const byId = new Map(catalogueCentres.map((centre) => [centre.id, centre]));
  for (const centre of publishedProfileCentres) byId.set(centre.id, centre);
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code));
}

/** Minimal compatibility projection for forms that need only an enquiry destination. */
export async function listPublicEnquiryCentres() {
  return (await listPublicCentres()).map(({ id, code, name }) => ({ id, code, name }));
}
