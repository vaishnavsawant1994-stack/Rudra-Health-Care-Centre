"use client";
import { useEffect, useState } from "react";

export function AdminDataPanel({ endpoint, label }: { endpoint: string; label: string }) {
  const [result, setResult] = useState("Loading current data…");
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const response = await fetch(endpoint, { cache: "no-store" });
        const body = await response.json();
        if (!live) return;
        if (response.ok) setResult(JSON.stringify(body, null, 2));
        else if (body.error === "setup_required") setResult(`Setup required: ${(body.missing ?? []).join(", ")} ${(body.invalid ?? []).join(", ")}`);
        else setResult(`Request unavailable (${body.error ?? "service error"}).`);
      } catch { if (live) setResult("Service unavailable. Check the database connection and try again."); }
    };
    void load();
    window.addEventListener("rudra-admin-data-refresh", load);
    return () => { live = false; window.removeEventListener("rudra-admin-data-refresh", load); };
  }, [endpoint]);
  return <section className="admin-card"><h2>{label}</h2><pre className="data-output">{result}</pre></section>;
}
