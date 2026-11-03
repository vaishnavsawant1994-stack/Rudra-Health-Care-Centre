/** A fixed workbench type constrains both the list and create flows. */
export function taskWorkbenchInitialTypeFilter(initialTaskType: string, fixedTaskType?: string) {
  return fixedTaskType ?? initialTaskType;
}

export function taskWorkbenchAuthorizedQueueCentre(initialCentreId: string | undefined, authorizedCentreIds: readonly string[]) {
  return initialCentreId && authorizedCentreIds.includes(initialCentreId) ? initialCentreId : "";
}
