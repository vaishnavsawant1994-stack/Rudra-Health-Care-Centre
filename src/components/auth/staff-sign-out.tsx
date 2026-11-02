"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export function StaffSignOut() {
  const [pending, setPending] = useState(false);
  const router = useRouter();
  async function signOut() { setPending(true); try { await authClient.signOut(); router.push("/staff"); } catch { setPending(false); } }
  return <button type="button" className="text-button" onClick={() => void signOut()} disabled={pending}>{pending ? "Signing out…" : "Sign out"}</button>;
}
