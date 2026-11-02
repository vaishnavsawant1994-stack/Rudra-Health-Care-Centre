export type PublicCentreSearchRecord = {
  id: string;
  code: string;
  name: string;
  publicProfile: { serviceArea: string | null } | null;
};

export function filterPublicCentres<T extends PublicCentreSearchRecord>(centres: readonly T[], query: string, serviceAreasOnly = false): T[] {
  const term = query.trim().toLocaleLowerCase();
  return centres.filter((centre) => {
    const area = centre.publicProfile?.serviceArea?.trim() ?? "";
    if (serviceAreasOnly && !area) return false;
    if (!term) return true;
    return centre.name.toLocaleLowerCase().includes(term)
      || centre.code.toLocaleLowerCase().includes(term)
      || area.toLocaleLowerCase().includes(term);
  });
}
