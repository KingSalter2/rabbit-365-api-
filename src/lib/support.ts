import type { SupabaseClient } from "@supabase/supabase-js";
import type { Bindings } from "../env";

export const SUPPORT_BUCKET = "support-attachments";
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const SIGNED_URL_TTL = 60 * 10; // 10 minutes

const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "application/zip",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
]);

const EXT_FALLBACK = /\.(png|jpe?g|webp|gif|pdf|zip|docx?|txt)$/i;

/** Normalise a user-entered website URL to include a scheme. */
export function normalizeUrl(value: string): string {
  const v = value.trim();
  if (!v) return v;
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

export type EmailRecipient = { email: string; fullName?: string | null };

/** Active portal members for an org, plus an optional fallback contact email. */
export async function orgRecipients(
  client: SupabaseClient,
  orgId: string,
  extra?: string | null,
): Promise<EmailRecipient[]> {
  const { data } = await client
    .from("client_members")
    .select("email,full_name,status")
    .eq("org_id", orgId)
    .eq("status", "active");
  const map = new Map<string, EmailRecipient>();
  for (const member of (data ?? []) as { email?: string; full_name?: string | null }[]) {
    if (member.email) {
      map.set(member.email, { email: member.email, fullName: member.full_name ?? null });
    }
  }
  if (extra && !map.has(extra)) map.set(extra, { email: extra, fullName: null });
  return [...map.values()];
}

export function statusLabel(status?: string | null): string {
  switch (status) {
    case "open":
      return "Open";
    case "in_progress":
      return "In progress";
    case "waiting_on_client":
      return "Waiting on client";
    case "resolved":
      return "Resolved";
    case "closed":
      return "Closed";
    default:
      return status ? status.replace(/_/g, " ") : "";
  }
}

export function isAllowedFile(mime: string | undefined, name: string): boolean {
  if (mime && ALLOWED_MIME.has(mime)) return true;
  return EXT_FALLBACK.test(name);
}

export type AttachmentView = {
  id: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  createdAt: string;
  url: string | null;
};

type AttachmentRow = {
  id: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
};

function toView(row: AttachmentRow, url: string | null): AttachmentView {
  return {
    id: row.id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
    url,
  };
}

/** List a ticket's attachments with short-lived signed URLs. */
export async function listAttachments(
  client: SupabaseClient,
  ticketId: string,
): Promise<AttachmentView[]> {
  const { data } = await client
    .from("support_attachments")
    .select("id,storage_path,file_name,mime_type,size_bytes,created_at")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true });

  const rows = (data ?? []) as AttachmentRow[];
  if (!rows.length) return [];

  return Promise.all(
    rows.map(async (row) => {
      const { data: signed } = await client.storage
        .from(SUPPORT_BUCKET)
        .createSignedUrl(row.storage_path, SIGNED_URL_TTL);
      return toView(row, signed?.signedUrl ?? null);
    }),
  );
}

export type SaveAttachmentInput = {
  client: SupabaseClient;
  orgId: string;
  ticketId: string;
  file: File;
  uploadedBy: string;
  messageId?: string | null;
};

export async function saveAttachment(
  input: SaveAttachmentInput,
): Promise<{ attachment?: AttachmentView; error?: string }> {
  const { client, orgId, ticketId, file } = input;

  if (!file || file.size <= 0) return { error: "The file is empty" };
  if (file.size > MAX_ATTACHMENT_BYTES) return { error: "File is too large (max 10 MB)" };
  if (!isAllowedFile(file.type, file.name)) return { error: "Unsupported file type" };

  const safeName =
    file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "file";
  const path = `${orgId}/${ticketId}/${crypto.randomUUID()}-${safeName}`;
  const buffer = await file.arrayBuffer();

  const { error: uploadError } = await client.storage
    .from(SUPPORT_BUCKET)
    .upload(path, buffer, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
  if (uploadError) return { error: uploadError.message };

  const { data: row, error: rowError } = await client
    .from("support_attachments")
    .insert({
      ticket_id: ticketId,
      message_id: input.messageId ?? null,
      storage_path: path,
      file_name: file.name,
      mime_type: file.type || null,
      size_bytes: file.size,
      uploaded_by: input.uploadedBy,
    })
    .select("id,storage_path,file_name,mime_type,size_bytes,created_at")
    .single();

  if (rowError || !row) {
    await client.storage.from(SUPPORT_BUCKET).remove([path]);
    return { error: rowError?.message ?? "Could not save attachment" };
  }

  const { data: signed } = await client.storage
    .from(SUPPORT_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL);

  return { attachment: toView(row as AttachmentRow, signed?.signedUrl ?? null) };
}

/** Delete every stored attachment belonging to an organisation. */
export async function removeOrgAttachments(
  client: SupabaseClient,
  orgId: string,
): Promise<void> {
  const bucket = client.storage.from(SUPPORT_BUCKET);
  const { data: entries } = await bucket.list(orgId, { limit: 1000 });
  const paths: string[] = [];

  for (const entry of entries ?? []) {
    if (entry.id) {
      paths.push(`${orgId}/${entry.name}`);
      continue;
    }
    const { data: nested } = await bucket.list(`${orgId}/${entry.name}`, { limit: 1000 });
    for (const file of nested ?? []) {
      if (file.id) paths.push(`${orgId}/${entry.name}/${file.name}`);
    }
  }

  if (paths.length) await bucket.remove(paths);
}

/** Resolve internal notification recipients: explicit list, else NOTIFY_EMAIL_TO. */
export function supportNotifyRecipients(env: Bindings): string[] {
  const raw = (env.SUPPORT_NOTIFY_EMAILS ?? env.NOTIFY_EMAIL_TO ?? "").trim();
  if (!raw) return [];
  return raw
    .split(/[,;]/)
    .map((value) => value.trim())
    .filter((value) => value.includes("@"));
}
