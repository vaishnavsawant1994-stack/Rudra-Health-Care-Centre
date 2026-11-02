export function mayBootstrapOwner(input) {
  return input.authorized === true && input.databaseRecordCount === 0;
}
