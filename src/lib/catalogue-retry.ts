export function catalogueRetryRequest(page: number, appendFailed: boolean) {
  return appendFailed
    ? { page: Math.max(1, page + 1), append: true }
    : { page: 1, append: false };
}
