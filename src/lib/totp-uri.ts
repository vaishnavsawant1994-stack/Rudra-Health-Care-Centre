export function parseTotpUri(value: string) {
  try {
    const uri = new URL(value);
    const secret = uri.searchParams.get("secret")?.toUpperCase() ?? "";
    if (uri.protocol !== "otpauth:" || uri.hostname !== "totp" || !/^[A-Z2-7]{16,128}$/.test(secret)) return null;
    return { uri: value, secret };
  } catch {
    return null;
  }
}
