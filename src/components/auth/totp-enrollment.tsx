"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { authClient } from "@/lib/auth-client";
import { parseTotpUri } from "@/lib/totp-uri";

export function TotpEnrollment() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [totpUri, setTotpUri] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function begin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    try {
      const result = await authClient.twoFactor.enable({ password, method: "totp" });
      if (result.error || !result.data || result.data.method !== "totp") {
        setMessage("Authenticator setup could not start. Check your password and try again.");
        return;
      }
      if (!parseTotpUri(result.data.totpURI)) {
        setMessage("Authenticator setup returned an invalid provisioning URI. Nothing was verified or enabled.");
        return;
      }
      setTotpUri(result.data.totpURI);
      setBackupCodes(result.data.backupCodes);
      setPassword("");
    } catch {
      setMessage("Authenticator setup could not start. Check your password and try again.");
    } finally {
      setPending(false);
    }
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    try {
      const result = await authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, ""), trustDevice: false });
      if (result.error) {
        setMessage("That authenticator code was not accepted. Try the current code from your app.");
        return;
      }
      router.replace("/staff/workspace");
      router.refresh();
    } catch {
      setMessage("Authenticator verification is unavailable. Try again.");
    } finally {
      setPending(false);
    }
  }

  const enrollment = totpUri ? parseTotpUri(totpUri) : null;
  return <section className="admin-card">
    <h2>Set up an authenticator app</h2>
    {!totpUri ? <form className="admin-form" onSubmit={begin}>
      <p>Enter your account password to begin enrollment. Your protected access stays locked until you verify a code.</p>
      <label>Account password<input type="password" autoComplete="current-password" minLength={12} maxLength={128} required value={password} onChange={(event) => setPassword(event.currentTarget.value)} /></label>
      <button className="button button-primary" disabled={pending}>{pending ? "Preparing…" : "Begin authenticator setup"}</button>
    </form> : <>
      <p>On your phone, open Google Authenticator, tap <strong>+</strong>, choose <strong>Scan a QR code</strong>, and scan the code from this screen.</p>
      {enrollment ? <div className="totp-qr-frame"><QRCodeSVG value={enrollment.uri} size={240} level="M" marginSize={4} title="Private Rudra authenticator setup QR code" /></div> : <p role="alert" className="auth-error">The authenticator setup URI is invalid. Do not continue; contact the Rudra administrator.</p>}
      <p className="setup-notice">This QR code is generated locally in your browser and contains your private authenticator secret. Keep this screen private; do not share or screenshot it.</p>
      <details className="totp-manual-fallback"><summary>Can’t scan? Show the manual setup key</summary><label>One-time Base32 setup key<input className="mono-value" readOnly value={enrollment?.secret ?? ""} autoComplete="off" /></label></details>
      <p className="setup-notice">Starting again before verification replaces any earlier pending setup secret and recovery codes. Save and use only the newest recovery codes. A verified authenticator is not replaced by this setup screen.</p>
      <h3>Recovery codes</h3>
      <p className="auth-help">Each recovery code works once. Store them privately; they are shown only during this setup.</p>
      <ul className="recovery-code-list">{backupCodes.map((backupCode) => <li key={backupCode}><code>{backupCode}</code></li>)}</ul>
      <form className="admin-form" onSubmit={verify}>
        <label>Current six-digit authenticator code<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(event) => setCode(event.currentTarget.value.replace(/\D/g, "").slice(0, 6))} /></label>
        <button className="button button-primary" disabled={pending || code.length !== 6}>{pending ? "Verifying…" : "Verify and finish setup"}</button>
      </form>
    </>}
    {message ? <p role="alert" className="auth-error">{message}</p> : null}
  </section>;
}
