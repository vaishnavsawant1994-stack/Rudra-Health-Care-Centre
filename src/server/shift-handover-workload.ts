import type { PermissionGrant } from "@/server/permissions";

export type HandoverWorkCategory = "appointments" | "collections" | "tasks";
export type HandoverWorkSnapshot = {
  capturedAt: string;
  categories: Partial<Record<HandoverWorkCategory, { count: number }>>;
};

const broadReadPermission: Record<HandoverWorkCategory, string> = {
  appointments: "appointments.read",
  collections: "collections.read",
  tasks: "tasks.read",
};

function hasCentrePermission(grants: readonly PermissionGrant[], permission: string, centreId: string) {
  return grants.some((grant) => grant.key === permission && (grant.centreId === null || grant.centreId === centreId));
}

/** Only centre-wide readers can create or see aggregate handover counts. */
export function readableHandoverCategories(grants: readonly PermissionGrant[], centreId: string) {
  return (Object.keys(broadReadPermission) as HandoverWorkCategory[])
    .filter((category) => hasCentrePermission(grants, broadReadPermission[category], centreId));
}

export function filterHandoverWorkSnapshot(
  snapshot: HandoverWorkSnapshot | null | undefined,
  grants: readonly PermissionGrant[],
  centreId: string,
): HandoverWorkSnapshot | null {
  if (!snapshot || typeof snapshot.capturedAt !== "string" || !Number.isFinite(Date.parse(snapshot.capturedAt)) || !snapshot.categories || typeof snapshot.categories !== "object") return null;
  const allowed = new Set(readableHandoverCategories(grants, centreId));
  const categories: HandoverWorkSnapshot["categories"] = {};
  for (const category of Object.keys(broadReadPermission) as HandoverWorkCategory[]) {
    const value = snapshot.categories[category];
    if (allowed.has(category) && value && Number.isSafeInteger(value.count) && value.count >= 0) categories[category] = { count: value.count };
  }
  return Object.keys(categories).length ? { capturedAt: snapshot.capturedAt, categories } : null;
}
