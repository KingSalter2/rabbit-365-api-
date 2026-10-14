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
