"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { postSignInRoute } from "@/lib/login-policy";

export function StaffLoginAction({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!enabled || pending) return;
    const form = new FormData(event.currentTarget);
    setPending(true);
    setMessage("");
    try {
      const result = await authClient.signIn.email({
        email: String(form.get("email") ?? "").trim(),
        password: String(form.get("password") ?? ""),
      });
      if (result.error) {
        setMessage("Sign-in failed. Check the email and password, or contact the Rudra owner.");
        return;
      }
      const route = postSignInRoute({
        twoFactorRedirect: "twoFactorRedirect" in result.data && result.data.twoFactorRedirect === true,
        twoFactorEnabled: result.data.user.twoFactorEnabled === true,
      });
      if (!route) {
        await authClient.signOut();
        router.replace("/staff");
        setMessage("Sign-in was blocked because the required authenticator challenge was not issued. Try again or contact the Rudra owner.");
        return;
      }
      router.replace(route);
    } catch {
      setMessage("Sign-in is temporarily unavailable. Try again later or contact the Rudra owner.");
    } finally {
      setPending(false);
    }
  }
  return <form className="admin-form auth-form" onSubmit={signIn}>
    <label>Work email<input name="email" type="email" autoComplete="username" maxLength={254} required disabled={!enabled || pending} /></label>
    <label>Password<input name="password" type="password" autoComplete="current-password" minLength={12} maxLength={128} required disabled={!enabled || pending} /></label>
    <button className="button button-primary" type="submit" disabled={!enabled || pending}>{pending ? "Signing in…" : "Sign in securely"}</button>
    <p className="auth-help">Owner and staff accounts are created by authorized Rudra administrators. Public registration is disabled. All accounts must enroll an authenticator before using protected tools.</p>
    {message ? <p role="alert" className="auth-error">{message}</p> : null}
  </form>;
}
