import { z } from "zod";

const optionalTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v && v.length ? v : undefined));

export const leadCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320),
  phone: optionalTrimmed(50),
  company: optionalTrimmed(200),
  website: optionalTrimmed(300),
  preferredContactMethod: optionalTrimmed(50),
  service: optionalTrimmed(200),
  budget: z
    .union([z.number(), z.string()])
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    }),
  message: optionalTrimmed(5000),
  category: optionalTrimmed(100),
  formType: optionalTrimmed(100),
  source: z.record(z.unknown()).optional(),
  fields: z.record(z.unknown()).optional(),
  turnstileToken: z.string().optional(),
});

export const leadUpdateSchema = z.object({
  status: z.enum(["new", "contacted", "won", "lost", "archived"]).optional(),
  internalNotes: z.string().trim().max(5000).optional(),
});

export const loginSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(200),
  turnstileToken: z.string().optional(),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().email().max(320),
  portal: z.enum(["admin", "client"]).optional(),
  turnstileToken: z.string().optional(),
});

export const resetPasswordSchema = z.object({
  accessToken: z.string().trim().min(1).max(8192),
  refreshToken: z.string().trim().max(8192).optional(),
  password: z.string().min(8).max(200),
});

export const registerSchema = z.object({
  inviteCode: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(320),
  password: z.string().min(8).max(200),
  fullName: z.string().trim().max(200).optional(),
  turnstileToken: z.string().optional(),
});

export const inviteCreateSchema = z.object({
  email: z.string().trim().email().max(320),
  role: z.enum(["admin", "superadmin"]).optional(),
  expiresInDays: z.number().int().min(1).max(90).optional(),
});

const scopeSectionSchema = z.object({
  title: z.string().trim().max(200),
  items: z.array(z.string().trim().max(500)).default([]),
});

const itemSchema = z.object({
  description: z.string().trim().max(500),
  amount: z.number(),
  kind: z.enum(["regular", "discount", "total"]).default("regular"),
});

export const quotationInputSchema = z.object({
  quoteNumber: optionalTrimmed(50),
  createdAt: optionalTrimmed(40),
  title: z.string().trim().min(1).max(300),
  project: optionalTrimmed(300),
  status: z.enum(["draft", "sent", "accepted", "rejected"]).optional(),
  currency: optionalTrimmed(5),
  client: z.object({
    name: z.string().trim().max(200).default(""),
    company: optionalTrimmed(200),
    email: z
      .string()
      .trim()
      .email()
      .max(320)
      .optional()
      .or(z.literal(""))
      .transform((v) => (v ? v : undefined)),
    phone: optionalTrimmed(50),
    address: optionalTrimmed(500),
  }),
  preparedBy: optionalTrimmed(200),
  validUntil: optionalTrimmed(20),
  notes: optionalTrimmed(5000),
  scope: z.array(scopeSectionSchema).default([]),
  items: z.array(itemSchema).default([]),
  terms: z.array(z.string().trim().max(1000)).default([]),
});

export const quotationAcceptSchema = z.object({
  name: z.string().trim().max(200).optional(),
  turnstileToken: z.string().optional(),
});

const progressStepSchema = z.object({
  position: z.number().int().min(0).max(100).optional(),
  label: z.string().trim().min(1).max(200),
  description: z.string().trim().max(500).optional(),
  status: z.enum(["pending", "in_progress", "done"]).default("pending"),
  note: z.string().trim().max(2000).optional(),
});

export const quotationProgressSchema = z.object({
  projectStatus: z.enum(["awaiting_deposit", "in_progress", "completed", "cancelled"]).optional(),
  note: optionalTrimmed(2000),
  notifyClient: z.boolean().optional(),
  steps: z.array(progressStepSchema).max(50).optional(),
});

export const bankingSchema = z.object({
  bankName: optionalTrimmed(120),
  accountName: optionalTrimmed(120),
  accountNumber: optionalTrimmed(40),
  accountType: optionalTrimmed(40),
  branchCode: optionalTrimmed(40),
});

export const bankingUpdateSchema = bankingSchema.extend({
  password: z.string().min(1).max(200),
});

export const reauthSchema = z.object({
  password: z.string().min(1).max(200),
});

export const mfaEnrollSchema = z.object({
  friendlyName: z.string().trim().max(80).optional(),
});

export const mfaChallengeSchema = z.object({
  factorId: z.string().uuid(),
});

export const mfaVerifySchema = z.object({
  factorId: z.string().uuid(),
  challengeId: z.string().uuid(),
  code: z.string().trim().min(6).max(10),
});

/* ------------------------------------------------------------------ */
/* Client support                                                      */
/* ------------------------------------------------------------------ */

const emailOptional = z
  .string()
  .trim()
  .email()
  .max(320)
  .optional()
  .or(z.literal(""))
  .transform((v) => (v ? v : undefined));

export const clientOrgSchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug: optionalTrimmed(120),
  primaryContactName: optionalTrimmed(200),
  contactEmail: emailOptional,
  contactPhone: optionalTrimmed(50),
  notes: optionalTrimmed(5000),
  relatedQuotationId: z.string().uuid().optional(),
  status: z.enum(["active", "suspended", "archived"]).optional(),
  supportEnabled: z.boolean().optional(),
});

export const clientOrgUpdateSchema = clientOrgSchema.partial();

export const clientSiteSchema = z.object({
  label: z.string().trim().min(1).max(200),
  url: z.string().trim().min(3).max(500),
  status: z.enum(["live", "maintenance", "offline", "archived"]).optional(),
});

export const clientSiteUpdateSchema = clientSiteSchema.partial();

export const clientInviteCreateSchema = z.object({
  email: z.string().trim().email().max(320),
  role: z.enum(["admin", "member"]).optional(),
  expiresInDays: z.number().int().min(1).max(90).optional(),
});

export const clientMemberUpdateSchema = z.object({
  role: z.enum(["admin", "member"]).optional(),
  status: z.enum(["active", "disabled"]).optional(),
});

export const clientRegisterSchema = z.object({
  inviteCode: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(320),
  password: z.string().min(8).max(200),
  fullName: z.string().trim().max(200).optional(),
  turnstileToken: z.string().optional(),
});

export const ticketCreateSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  category: z.enum(["support", "maintenance", "bug", "request", "other"]).default("support"),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  siteId: z.string().uuid().optional(),
  body: z.string().trim().min(1).max(10000),
});

export const ticketReplySchema = z.object({
  body: z.string().trim().min(1).max(10000),
});

export const ticketAgentReplySchema = ticketReplySchema.extend({
  isInternal: z.boolean().optional(),
  resolve: z.boolean().optional(),
});

export const ticketUpdateSchema = z.object({
  status: z
    .enum(["open", "in_progress", "waiting_on_client", "resolved", "closed"])
    .optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  assignedTo: z.string().uuid().nullable().optional(),
  category: z.enum(["support", "maintenance", "bug", "request", "other"]).optional(),
  relatedQuotationId: z.string().uuid().nullable().optional(),
});

export const clientAssetRequestSchema = z.object({
  purpose: z.string().trim().max(40).optional(),
});

export const outreachSendSchema = z.object({
  to: z.string().trim().email().max(320),
  subject: z.string().trim().min(1).max(300),
  html: z.string().trim().max(200000).optional(),
  text: z.string().trim().max(200000).optional(),
  businessName: z.string().trim().max(200).optional(),
  observation: z.string().trim().max(2000).optional(),
  messageHtml: z.string().trim().max(200000).optional(),
});
