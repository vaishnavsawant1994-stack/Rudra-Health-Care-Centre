export function postSignInRoute(input: { twoFactorRedirect: boolean; twoFactorEnabled: boolean }) {
  if (input.twoFactorRedirect) return "/staff/two-factor" as const;
  if (input.twoFactorEnabled) return null;
  return "/staff/security-setup" as const;
}
