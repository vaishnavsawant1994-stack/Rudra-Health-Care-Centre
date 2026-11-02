export function isMfaSessionAuthorized(twoFactorEnabled: boolean, totpVerified: boolean, mfaVerifiedAt: Date | null | undefined) {
  return twoFactorEnabled === true
    && totpVerified === true
    && mfaVerifiedAt instanceof Date
    && Number.isFinite(mfaVerifiedAt.getTime());
}

export function withoutTrustedDeviceCookie(request: Request) {
  const headers = new Headers(request.headers);
  const cookieHeader = headers.get("cookie");
  if (!cookieHeader) return request;
  const cookies = cookieHeader.split(";").map((cookie) => cookie.trim()).filter(Boolean);
  const retained = cookies.filter((cookie) => {
    const separator = cookie.indexOf("=");
    const name = (separator === -1 ? cookie : cookie.slice(0, separator)).trim().replace(/^__Secure-/i, "");
    return !name.toLowerCase().endsWith("trust_device");
  });
  if (retained.length === cookies.length) return request;
  if (retained.length) headers.set("cookie", retained.join("; "));
  else headers.delete("cookie");
  return new Request(request, { headers });
}
