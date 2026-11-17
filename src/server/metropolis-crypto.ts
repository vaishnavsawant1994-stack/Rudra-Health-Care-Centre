import { createHmac } from "node:crypto";

/** Deterministic, keyed lookup value for collision checks; never store a plain external reference for indexing. */
export function blindIndexMetropolisReference(value: string) {
  const key = Buffer.from(process.env.RUDRA_BLIND_INDEX_KEY ?? "", "base64");
  if (key.length !== 32) throw new Error("blind_index_key_unavailable");
  const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleUpperCase("en-US");
  if (!normalized) throw new Error("invalid_external_reference");
  return createHmac("sha256", key).update("rudra:metropolis-reference:v1:").update(normalized).digest("hex");
}
