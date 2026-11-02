"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { PageTitle } from "@/components/ui/page-title";
import { authClient } from "@/lib/auth-client";

export default function TwoFactorPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [backupMode, setBackupMode] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    try {
      const result = backupMode
        ? await authClient.twoFactor.verifyBackupCode({ code: code.trim(), trustDevice: false })
        : await authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, ""), trustDevice: false });
      if (result.error) {
        setMessage("Code not accepted. Try again with the current code or a saved recovery code.");
        return;
      }
      router.replace("/staff/workspace");
      router.refresh();
    } catch {
      setMessage("Verification is temporarily unavailable. Try again.");
    } finally {
      setPending(false);
    }
  }

  return <main className="inner-page"><div className="page-container"><PageTitle eyebrow="Second factor" title="Verify your authenticator" description="Enter the current code from your authenticator app. This device will not be remembered." />
    <section className="admin-card"><form className="admin-form" onSubmit={verify}>
      <label>{backupMode ? "Recovery code" : "Six-digit code"}<input autoComplete={backupMode ? "off" : "one-time-code"} inputMode={backupMode ? "text" : "numeric"} maxLength={backupMode ? 24 : 6} pattern={backupMode ? undefined : "[0-9]{6}"} required value={code} onChange={(event) => setCode(backupMode ? event.currentTarget.value : event.currentTarget.value.replace(/\D/g, "").slice(0, 6))} /></label>
      <button className="button button-primary" disabled={pending || (!backupMode && code.length !== 6)}>{pending ? "Verifying…" : "Verify"}</button>
      <button className="text-button" type="button" onClick={() => { setBackupMode((current) => !current); setCode(""); setMessage(""); }}>{backupMode ? "Use authenticator code" : "Use a recovery code"}</button>
      {message ? <p role="alert" className="auth-error">{message}</p> : null}
    </form></section>
  </div></main>;
}
