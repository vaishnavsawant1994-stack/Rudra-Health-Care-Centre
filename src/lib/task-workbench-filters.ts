/** A fixed workbench type constrains both the list and create flows. */
export function taskWorkbenchInitialTypeFilter(initialTaskType: string, fixedTaskType?: string) {
  return fixedTaskType ?? initialTaskType;
}
