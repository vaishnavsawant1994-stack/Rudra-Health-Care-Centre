import { z } from "zod";

export const communicationTemplateContentSchema = z.object({
  name: z.string().trim().min(2).max(80),
  body: z.string().trim().min(1).max(2000),
}).strict().superRefine(({ body }, context) => {
  const tokens = [...body.matchAll(/{{\s*([^{}]+?)\s*}}/g)].map((match) => match[1]);
  const allowed = new Set(["firstName", "leadNumber", "serviceName", "centreName", "appointmentDate"]);
  for (const token of tokens) {
    if (!allowed.has(token)) context.addIssue({ code: "custom", path: ["body"], message: `Unsupported template variable: ${token}` });
  }
  if (body.replace(/{{\s*[^{}]+?\s*}}/g, "").includes("{{") || body.replace(/{{\s*[^{}]+?\s*}}/g, "").includes("}}")) {
    context.addIssue({ code: "custom", path: ["body"], message: "Template variables must use a supported {{variable}} name." });
  }
});

export type CommunicationTemplateVariables = Partial<Record<"firstName" | "leadNumber" | "serviceName" | "centreName" | "appointmentDate", string>>;

export function renderCommunicationTemplate(body: string, variables: CommunicationTemplateVariables) {
  const tokens = [...new Set([...body.matchAll(/{{\s*([^{}]+?)\s*}}/g)].map((match) => match[1]))];
  const missing = tokens.filter((token) => !variables[token as keyof CommunicationTemplateVariables]?.trim());
  if (missing.length) return { ok: false as const, missing };
  const rendered = body.replace(/{{\s*([^{}]+?)\s*}}/g, (_match, token: string) => variables[token as keyof CommunicationTemplateVariables] ?? "");
  return { ok: true as const, body: rendered.trim() };
}

export const communicationTemplateCreateSchema = z.object({
  centreId: z.uuid(), idempotencyKey: z.uuid(), purpose: z.enum(["OPERATIONAL", "MARKETING"]), channel: z.enum(["PHONE", "EMAIL", "WHATSAPP"]),
  name: communicationTemplateContentSchema.shape.name, body: communicationTemplateContentSchema.shape.body,
}).strict().superRefine((value, context) => {
  const checked = communicationTemplateContentSchema.safeParse({ name: value.name, body: value.body });
  if (!checked.success) for (const issue of checked.error.issues) context.addIssue({ code: "custom", path: issue.path, message: issue.message });
});

export const communicationTemplatePatchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("UPDATE"), expectedVersion: z.number().int().positive(), name: communicationTemplateContentSchema.shape.name.optional(), body: communicationTemplateContentSchema.shape.body.optional() }).strict().refine((value) => value.name !== undefined || value.body !== undefined, "Provide a template change."),
  z.object({ action: z.literal("ACTIVATE"), expectedVersion: z.number().int().positive(), reason: z.string().trim().min(3).max(240) }).strict(),
  z.object({ action: z.literal("ARCHIVE"), expectedVersion: z.number().int().positive(), reason: z.string().trim().min(3).max(240) }).strict(),
]).superRefine((value, context) => {
  if (value.action === "UPDATE" && value.body !== undefined) {
    const checked = communicationTemplateContentSchema.shape.body.safeParse(value.body);
    if (!checked.success) for (const issue of checked.error.issues) context.addIssue({ code: "custom", path: issue.path, message: issue.message });
  }
});
