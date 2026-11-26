/**
 * Central email templates for Rabbit 365.
 *
 * All transactional email HTML lives here. Resend is only the transport
 * (see `lib/resend.ts`); it does NOT store these templates. Edit this file to
 * change what customers and the team receive.
 *
 * Preview them locally at: /dev/emails  (dev only, see routes/dev.ts)
 */

import { isBankingEmpty, type BankingDetails } from "./settings";

export type EmailContent = { subject: string; html: string };

/* ------------------------------------------------------------------ */
/* Brand                                                               */
/* ------------------------------------------------------------------ */

const BRAND = {
  name: "Rabbit 365",
  tagline: "Creativity, Every Day.",
  site: "https://www.rabbit365.co.za",
  email: "info@rabbit365.co.za",
  address: "14608/6 Salt Lake City Street, Beverly Hills, Vereeniging, Johannesburg South",
  logo: "https://www.rabbit365.co.za/rabbit_365_logo.png",
};

const COLOR = {
  mint: "#10B77F",
  ink: "#0F172A",
  body: "#334155",
  muted: "#64748B",
  border: "#E7ECF1",
  bg: "#F4F6F8",
  panel: "#F8FAFC",
  charcoal: "#14181F",
  footerText: "#94A3B8",
};

const FONT_STACK =
  "'Plus Jakarta Sans', -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/**
 * Absolute URL for the brand logo, served by this API (`/api/assets/logo.png`)
 * so emails never depend on the marketing site being reachable. Pass ASSET_URL
 * (the public URL); when blank it defaults to the production site, so emails
 * sent from local dev still load a reachable logo for the recipient.
 */
export function brandLogoUrl(baseUrl?: string): string {
  const raw = (baseUrl || "").replace(/\/$/, "");
  const base = raw && !/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(raw) ? raw : BRAND.site;
  return `${base}/api/assets/logo.png`;
}

export function brandLogoAsset(baseUrl?: string): { url: string; cid: string; filename: string; contentType: string } {
  return { url: brandLogoUrl(baseUrl), cid: "rabbit365-logo", filename: "rabbit365-logo.png", contentType: "image/png" };
}

/** Escape user-provided values before embedding them in HTML. */
function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

/* ------------------------------------------------------------------ */
/* Building blocks                                                     */
/* ------------------------------------------------------------------ */

type DetailRow = { label: string; value?: string | number | null };

function detailTable(rows: DetailRow[]): string {
  const visible = rows.filter((row) => row.value !== undefined && row.value !== null && `${row.value}` !== "");
  if (!visible.length) return "";
  const cells = visible
    .map(
      (row, index) => `
        <tr>
          <td style="padding:12px 18px;width:42%;background:${index % 2 ? COLOR.panel : "#FFFFFF"};border-bottom:1px solid ${COLOR.border};font-size:13px;color:${COLOR.muted}">${esc(
            row.label,
          )}</td>
          <td style="padding:12px 18px;background:${index % 2 ? COLOR.panel : "#FFFFFF"};border-bottom:1px solid ${COLOR.border};font-size:14px;font-weight:600;color:${COLOR.ink}">${esc(
            row.value,
          )}</td>
        </tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid ${COLOR.border};border-radius:12px;overflow:hidden;margin:0 0 20px">${cells}</table>`;
}

function callout(label: string, value: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px">
    <tr>
      <td style="background:${COLOR.panel};border-left:3px solid ${COLOR.mint};border-radius:0 12px 12px 0;padding:16px 18px">
        <p style="margin:0 0 6px;font-size:12px;letter-spacing:.4px;text-transform:uppercase;color:${COLOR.muted}">${esc(
          label,
        )}</p>
        <p style="margin:0;font-size:14px;line-height:22px;color:${COLOR.body};white-space:pre-wrap">${esc(value)}</p>
      </td>
    </tr>
  </table>`;
}

function banner(text: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px">
    <tr>
      <td style="background:#ECFDF5;border:1px solid #A7F3D0;border-radius:12px;padding:14px 18px;font-size:14px;font-weight:700;color:#047857">
        &#10003;&nbsp;&nbsp;${esc(text)}
      </td>
    </tr>
  </table>`;
}

function sectionHeading(text: string): string {
  return `<h2 style="margin:28px 0 14px;font-size:12px;letter-spacing:.8px;text-transform:uppercase;font-weight:700;color:${COLOR.muted}">${esc(text)}</h2>`;
}

function bankingBlock(banking: BankingDetails, reference?: string): string {
  const rows: DetailRow[] = [
    { label: "Bank", value: banking.bankName },
    { label: "Account name", value: banking.accountName },
    { label: "Account number", value: banking.accountNumber },
    { label: "Account type", value: banking.accountType },
    { label: "Branch code", value: banking.branchCode },
    { label: "Payment reference", value: reference },
  ];
  return detailTable(rows);
}

function paymentSection(banking: BankingDetails | null | undefined, reference?: string): string {
  if (isBankingEmpty(banking)) return "";
  return (
    sectionHeading("Payment details") +
    bankingBlock(banking as BankingDetails, reference) +
    `<p style="margin:0 0 20px;font-size:13px;line-height:21px;color:${COLOR.muted}">Please use the payment reference above so we can match your payment to this quotation.</p>`
  );
}

function button(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 4px">
    <tr>
      <td align="center" style="background:${COLOR.mint};border-radius:10px">
        <a href="${esc(url)}" target="_blank" style="display:inline-block;padding:14px 30px;font-family:${FONT_STACK};font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px">${esc(
          label,
        )}</a>
      </td>
    </tr>
  </table>`;
}

type LayoutInput = {
  preheader: string;
  heading: string;
  intro?: string;
  content: string;
  cta?: { label: string; url: string };
  footerNote?: string;
  logoUrl?: string;
  logoCid?: string;
};

export const EMAIL_LOGO_CID = "rabbit365-logo";

function layout(input: LayoutInput): string {
  const year = new Date().getFullYear();
  const logoUrl = input.logoCid ? `cid:${input.logoCid}` : input.logoUrl || BRAND.logo;
  const intro = input.intro
    ? `<p class="rb-text" style="margin:0 0 24px;font-size:16px;line-height:28px;color:${COLOR.body}">${input.intro}</p>`
    : "";
  const cta = input.cta ? button(input.cta.label, input.cta.url) : "";
  const footerNote = input.footerNote
    ? `<p style="margin:28px 0 0;padding-top:24px;border-top:1px solid ${COLOR.border};font-size:14px;line-height:24px;color:${COLOR.muted}">${input.footerNote}</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="x-apple-disable-message-reformatting" />
  <meta name="color-scheme" content="light only" />
  <title>${esc(input.heading)}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');
    body { margin:0; padding:0; width:100% !important; background:${COLOR.bg}; }
    a { text-decoration:none; }
    table { border-collapse:collapse; }
    @media (max-width:840px) {
      .rb-outer { padding:16px 10px !important; }
      .rb-card { width:100% !important; max-width:100% !important; border-radius:14px !important; }
      .rb-header { padding:24px 24px 18px !important; }
      .rb-body { padding:28px 24px 30px !important; }
      .rb-footer { padding:26px 24px !important; }
      .rb-h1 { font-size:26px !important; line-height:34px !important; }
      .rb-text { font-size:15px !important; line-height:27px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:${COLOR.bg};font-family:${FONT_STACK};-webkit-font-smoothing:antialiased">
  <div style="display:none;font-size:1px;color:${COLOR.bg};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${esc(
    input.preheader,
  )}${"&nbsp;&zwnj;".repeat(40)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLOR.bg}">
    <tr>
      <td class="rb-outer" align="center" style="padding:40px 20px">
        <table role="presentation" class="rb-card" width="1200" cellpadding="0" cellspacing="0" style="width:100%;max-width:1200px;background:#ffffff;border:1px solid ${COLOR.border};border-radius:18px;overflow:hidden;box-shadow:0 10px 30px rgba(15,23,42,.05)">
          <tr><td style="height:4px;line-height:4px;font-size:0;background:${COLOR.mint}">&nbsp;</td></tr>
          <tr>
            <td class="rb-header" style="padding:32px 56px 24px;border-bottom:1px solid ${COLOR.border}">
              <img src="${logoUrl}" alt="${BRAND.name}" width="168" height="42" style="display:block;width:auto;max-width:180px;height:42px;border:0;outline:none;text-decoration:none" />
            </td>
          </tr>
          <tr>
            <td class="rb-body" style="padding:44px 56px 48px">
              <h1 class="rb-h1" style="margin:0 0 20px;font-size:30px;line-height:38px;font-weight:800;letter-spacing:-0.4px;color:${COLOR.ink}">${esc(
                input.heading,
              )}</h1>
              ${intro}
              ${input.content}
              ${cta}
              ${footerNote}
            </td>
          </tr>
          <tr>
            <td class="rb-footer" style="background:${COLOR.charcoal};padding:32px 56px">
              <p style="margin:0 0 4px;font-size:16px;font-weight:800;color:#ffffff">${BRAND.name}</p>
              <p style="margin:0 0 16px;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${COLOR.mint}">${BRAND.tagline}</p>
              <p style="margin:0 0 6px;font-size:13px;line-height:20px;color:${COLOR.footerText}">
                <a href="mailto:${BRAND.email}" style="color:${COLOR.mint};text-decoration:none;font-weight:600">${BRAND.email}</a>
              </p>
              <p style="margin:0 0 6px;font-size:13px;line-height:20px;color:${COLOR.footerText}">${esc(BRAND.address)}</p>
              <p style="margin:0;font-size:13px;line-height:20px">
                <a href="${BRAND.site}" style="color:${COLOR.mint};text-decoration:none;font-weight:600">${BRAND.site.replace(
                  "https://",
                  "",
                )}</a>
              </p>
              <p style="margin:18px 0 0;padding-top:16px;border-top:1px solid rgba(255,255,255,.12);font-size:12px;line-height:18px;color:#64748B">
                &copy; ${year} ${BRAND.name}. All rights reserved.
              </p>
              <p style="margin:12px 0 0;font-size:11px;line-height:17px;color:#64748B"><strong style="color:#94A3B8">Disclaimer:</strong> This message and its attachments is intended for the exclusive use of the named recipients hereof and may contain information that is privileged or confidential or otherwise restricted from disclosure wider than the named recipients. If you are not the named recipient, you are not authorized to read, use, transmit, print, retain, copy or disseminate this message or any part thereof, or the attachments thereto. If you have received this message in error, please notify the sender immediately via e-mail and discard (de-identify) any paper copies and delete all electronic files of the message.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/* ------------------------------------------------------------------ */
/* Templates                                                           */
/* ------------------------------------------------------------------ */

export type LeadEmailData = {
  name: string;
  email: string;
  phone?: string | null;
  company?: string | null;
  service?: string | null;
  budget?: string | number | null;
  category?: string | null;
  formType?: string | null;
  message?: string | null;
};

/** Internal notification: a new website enquiry was submitted. */
export function leadNotificationEmail(
  lead: LeadEmailData,
  opts: { portalUrl: string; logoUrl?: string },
): EmailContent {
  const rows: DetailRow[] = [
    { label: "Name", value: lead.name },
    { label: "Email", value: lead.email },
    { label: "Phone", value: lead.phone },
    { label: "Company", value: lead.company },
    { label: "Service", value: lead.service },
    { label: "Budget", value: lead.budget },
    { label: "Category", value: lead.category },
    { label: "Form", value: lead.formType },
  ];

  const content =
    detailTable(rows) + (lead.message ? callout("Message", lead.message) : "");

  return {
    subject: `New enquiry: ${lead.category ?? "general"}  -  ${lead.name}`,
    html: layout({
      preheader: `New website enquiry from ${lead.name}.`,
      heading: "New website enquiry",
      intro: `A new ${esc(lead.formType ?? "website")} form was submitted on rabbit365.co.za. Reply to this email to respond to ${esc(
        lead.name,
      )} directly.`,
      content,
      cta: opts.portalUrl ? { label: "Open in portal", url: opts.portalUrl } : undefined,
      logoUrl: opts.logoUrl,
    }),
  };
}

/** Confirmation sent to the person who submitted a website enquiry form. */
export function leadConfirmationEmail(
  lead: LeadEmailData,
  opts: { logoUrl?: string; siteUrl?: string } = {},
): EmailContent {
  const firstName = (lead.name || "there").trim().split(/\s+/)[0];

  const rows: DetailRow[] = [
    { label: "Name", value: lead.name },
    { label: "Email", value: lead.email },
    { label: "Phone", value: lead.phone },
    { label: "Company", value: lead.company },
    { label: "Service", value: lead.service },
    { label: "Budget", value: lead.budget },
  ];

  return {
    subject: "We've received your enquiry  -  Rabbit 365",
    html: layout({
      preheader: "Thanks for reaching out  -  a member of our team will be in touch shortly.",
      heading: `Thanks, ${firstName}!`,
      intro:
        "We've received your message and a member of our team will get back to you within one business day. For your records, here's a copy of what you sent us:",
      content:
        detailTable(rows) + (lead.message ? callout("Your message", lead.message) : ""),
      cta: { label: "Explore our work", url: opts.siteUrl || BRAND.site },
      footerNote: "In a hurry? Just reply to this email and we'll pick it up from there.",
      logoUrl: opts.logoUrl,
    }),
  };
}

export type QuotationAcceptedTeamData = {
  quoteNumber: string;
  title: string;
  acceptedByName: string;
  company?: string | null;
  clientEmail?: string | null;
  total: string;
  acceptedAt: string;
  portalUrl: string;
  logoUrl?: string;
};

/** Internal notification: a client accepted a quotation. */
export function quotationAcceptedTeamEmail(data: QuotationAcceptedTeamData): EmailContent {
  const rows: DetailRow[] = [
    { label: "Quote", value: data.quoteNumber },
    { label: "Title", value: data.title },
    {
      label: "Accepted by",
      value: data.company ? `${data.acceptedByName} (${data.company})` : data.acceptedByName,
    },
    { label: "Client email", value: data.clientEmail },
    { label: "Total", value: data.total },
    { label: "Accepted at", value: data.acceptedAt },
  ];

  return {
    subject: `Quotation accepted: ${data.quoteNumber}  -  ${data.title}`,
    html: layout({
      preheader: `${data.acceptedByName} accepted ${data.quoteNumber}.`,
      heading: "Quotation accepted",
      intro: "Good news  -  a client has accepted a quotation. Reach out to confirm the next steps.",
      content: detailTable(rows),
      cta: data.portalUrl ? { label: "Open in portal", url: data.portalUrl } : undefined,
      logoUrl: data.logoUrl,
    }),
  };
}

export type QuotationClientConfirmData = {
  clientName: string;
  quoteNumber: string;
  title: string;
  total: string;
  acceptedAt: string;
  quotationUrl?: string;
  banking?: BankingDetails | null;
  reference?: string;
  logoUrl?: string;
};

/** Confirmation sent to the client once they accept a quotation. */
export function quotationAcceptanceClientEmail(data: QuotationClientConfirmData): EmailContent {
  const rows: DetailRow[] = [
    { label: "Quote", value: data.quoteNumber },
    { label: "Title", value: data.title },
    { label: "Total", value: data.total },
    { label: "Accepted at", value: data.acceptedAt },
  ];

  return {
    subject: `Thank you  -  quotation ${data.quoteNumber} accepted`,
    html: layout({
      preheader: `We've received your acceptance of ${data.quoteNumber}.`,
      heading: `Thank you, ${data.clientName}!`,
      intro:
        "We've received your acceptance of the quotation below. Our team will be in touch shortly to get started.",
      content: banner("Quotation accepted") + detailTable(rows) + paymentSection(data.banking, data.reference),
      cta: data.quotationUrl ? { label: "View your quotation", url: data.quotationUrl } : undefined,
      footerNote:
        "If you did not accept this quotation, please reply to this email and let us know.",
      logoUrl: data.logoUrl,
    }),
  };
}

/* ------------------------------------------------------------------ */
/* Project progress                                                    */
/* ------------------------------------------------------------------ */

export type ProgressStepView = {
  label: string;
  description?: string;
  status: "pending" | "in_progress" | "done";
};

function progressList(steps: ProgressStepView[]): string {
  const rows = steps
    .map((step) => {
      const done = step.status === "done";
      const active = step.status === "in_progress";
      const dot = done
        ? `<span style="display:inline-block;width:20px;height:20px;border-radius:50%;background:${COLOR.mint};color:#ffffff;font-size:12px;line-height:20px;text-align:center;font-weight:700">&#10003;</span>`
        : active
          ? `<span style="display:inline-block;width:20px;height:20px;border-radius:50%;border:2px solid ${COLOR.mint};background:#ECFDF5"></span>`
          : `<span style="display:inline-block;width:20px;height:20px;border-radius:50%;border:2px solid ${COLOR.border};background:#ffffff"></span>`;
      const tag = active
        ? `<span style="margin-left:8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:${COLOR.mint}">In progress</span>`
        : done
          ? `<span style="margin-left:8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:#94A3B8">Done</span>`
          : "";
      const labelColor = active || done ? COLOR.ink : COLOR.muted;
      return `<tr>
        <td style="width:34px;vertical-align:top;padding:11px 0">${dot}</td>
        <td style="padding:11px 0 11px 8px;border-bottom:1px solid ${COLOR.border}">
          <span style="font-size:14px;font-weight:${active || done ? 700 : 600};color:${labelColor}">${esc(
            step.label,
          )}</span>${tag}
          ${
            step.description
              ? `<div style="margin-top:2px;font-size:12px;line-height:18px;color:${COLOR.muted}">${esc(
                  step.description,
                )}</div>`
              : ""
          }
        </td>
      </tr>`;
    })
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 20px">${rows}</table>`;
}

export type QuotationProgressEmailData = {
  clientName: string;
  quoteNumber: string;
  title: string;
  statusLabel: string;
  steps: ProgressStepView[];
  note?: string | null;
  quotationUrl?: string;
  banking?: BankingDetails | null;
  reference?: string;
  logoUrl?: string;
};

/** Sent to the client whenever their project progress is updated. */
export function quotationProgressEmail(data: QuotationProgressEmailData): EmailContent {
  return {
    subject: `Project update: ${data.quoteNumber}  -  ${data.statusLabel}`,
    html: layout({
      preheader: `${data.title} is now: ${data.statusLabel}.`,
      heading: `Update on ${data.quoteNumber}`,
      intro: `Hi ${data.clientName || "there"}, here's the latest on your project.`,
      content:
        banner(`Status: ${data.statusLabel}`) +
        progressList(data.steps) +
        (data.note ? callout("Note from the team", data.note) : "") +
        paymentSection(data.banking, data.reference),
      cta: data.quotationUrl ? { label: "View project progress", url: data.quotationUrl } : undefined,
      footerNote: "You'll receive an email each time your project moves forward.",
      logoUrl: data.logoUrl,
    }),
  };
}

/* ------------------------------------------------------------------ */
/* Client support                                                      */
/* ------------------------------------------------------------------ */

export type SupportTicketEmailData = {
  appUrl: string;
  ticketId: string;
  number: string;
  subject: string;
  orgName: string;
  siteLabel?: string | null;
  siteUrl?: string | null;
  category: string;
  priority: string;
  status?: string;
  /** Name of the person who wrote the message (agent for client emails, client for team emails). */
  authorName?: string;
  /** Name of the client being greeted  -  never the agent's name. */
  clientName?: string;
  message?: string;
  /** True when the reply also resolved the ticket (reply & resolve). */
  resolved?: boolean;
  logoUrl?: string;
};

function supportTicketUrl(appUrl: string, ticketId: string): string {
  return `${appUrl.replace(/\/$/, "")}/support/tickets/${ticketId}`;
}

function supportDetails(data: SupportTicketEmailData): string {
  const site = [data.siteLabel, data.siteUrl].filter(Boolean).join("  -  ");
  return detailTable([
    { label: "Ticket", value: data.number },
    { label: "Subject", value: data.subject },
    { label: "Client", value: data.orgName },
    { label: "Website", value: site },
    { label: "Category", value: data.category },
    { label: "Priority", value: data.priority },
    { label: "Status", value: data.status },
  ]);
}

export function supportTicketCreatedClient(data: SupportTicketEmailData): EmailContent {
  return {
    subject: `We've received your request  -  ${data.number}`,
    html: layout({
      preheader: `Ticket ${data.number} has been created.`,
      heading: "We've got your request",
      intro: `Hi ${esc(data.clientName || "there")}, thanks for getting in touch. Our team will review your ticket and reply as soon as possible.`,
      content:
        supportDetails({ ...data, status: "Open" }) +
        (data.message ? callout("Your message", data.message) : ""),
      cta: { label: "View ticket", url: supportTicketUrl(data.appUrl, data.ticketId) },
      footerNote: "You can reply to this ticket anytime from the client portal.",
      logoUrl: data.logoUrl,
    }),
  };
}

export function supportTicketCreatedTeam(data: SupportTicketEmailData): EmailContent {
  return {
    subject: `New support ticket ${data.number}  -  ${data.orgName}`,
    html: layout({
      preheader: `${data.orgName} raised ${data.number}.`,
      heading: "New support ticket",
      intro: `${data.orgName} has raised a new request.`,
      content:
        supportDetails({ ...data, status: "Open" }) +
        (data.message ? callout("Message", data.message) : ""),
      cta: { label: "Open support queue", url: `${data.appUrl.replace(/\/$/, "")}/ops` },
      logoUrl: data.logoUrl,
    }),
  };
}

export function supportTicketReplyClient(data: SupportTicketEmailData): EmailContent {
  return {
    subject: `New reply on ${data.number}  -  ${data.subject}`,
    html: layout({
      preheader: `The team replied to ${data.number}.`,
      heading: "You have a new reply",
      intro: `Hi ${esc(data.clientName || "there")}, the Rabbit 365 team replied to your ticket.`,
      content:
        supportDetails(data) +
        (data.message
          ? callout(`Reply from ${data.authorName || "the Rabbit 365 team"}`, data.message)
          : "") +
        (data.resolved
          ? callout(
              "Ticket resolved",
              "We've marked this request as resolved. If you need anything else, just reply to this email and it will reopen the ticket.",
            )
          : ""),
      cta: { label: "View and reply", url: supportTicketUrl(data.appUrl, data.ticketId) },
      footerNote: data.resolved
        ? "Replying to this email will reopen the ticket."
        : "For the fastest response, please reply inside the portal.",
      logoUrl: data.logoUrl,
    }),
  };
}

export function supportTicketReplyTeam(data: SupportTicketEmailData): EmailContent {
  return {
    subject: `Client reply on ${data.number}  -  ${data.orgName}`,
    html: layout({
      preheader: `${data.orgName} replied to ${data.number}.`,
      heading: "New client reply",
      intro: `${data.orgName} replied to ${data.number}.`,
      content:
        supportDetails(data) +
        (data.message ? callout(`Reply from ${data.authorName || "the client"}`, data.message) : ""),
      cta: { label: "Open support queue", url: `${data.appUrl.replace(/\/$/, "")}/ops` },
      logoUrl: data.logoUrl,
    }),
  };
}

export function supportTicketStatusClient(data: SupportTicketEmailData): EmailContent {
  return {
    subject: `${data.number} is now ${data.status}`,
    html: layout({
      preheader: `Ticket ${data.number} has been updated.`,
      heading: "Your ticket was updated",
      intro: `Hi ${esc(data.clientName || "there")}, the status of your ticket has changed to ${data.status}.`,
      content:
        supportDetails(data) +
        (data.message ? callout("Note from the team", data.message) : ""),
      cta: { label: "View ticket", url: supportTicketUrl(data.appUrl, data.ticketId) },
      logoUrl: data.logoUrl,
    }),
  };
}

export function supportTicketReminderClient(data: SupportTicketEmailData): EmailContent {
  return {
    subject: `Still need a hand with ${data.number}?`,
    html: layout({
      preheader: `We're waiting to hear back about ${data.number}.`,
      heading: "We're waiting to hear back",
      intro: `Hi ${esc(data.clientName || "there")}, we replied to your ticket ${data.number} and we're waiting to hear back from you.`,
      content:
        supportDetails(data) +
        callout(
          "What happens next",
          "If we don't hear back within 7 days, we'll close this ticket. You can reply anytime to reopen it.",
        ),
      cta: { label: "View and reply", url: supportTicketUrl(data.appUrl, data.ticketId) },
      footerNote: "If everything is resolved, no action is needed  -  we'll close the ticket automatically.",
      logoUrl: data.logoUrl,
    }),
  };
}

export function supportTicketAutoClosedClient(data: SupportTicketEmailData): EmailContent {
  return {
    subject: `${data.number} has been closed`,
    html: layout({
      preheader: `Ticket ${data.number} was closed after no reply.`,
      heading: "We've closed this ticket",
      intro: `Hi ${esc(data.clientName || "there")}, we didn't hear back about ${data.number}, so we've closed it for now.`,
      content:
        supportDetails(data) +
        callout(
          "Need more help?",
          "Just reply to this email or reopen the ticket from the client portal and we'll pick it up again.",
        ),
      cta: { label: "Reopen ticket", url: supportTicketUrl(data.appUrl, data.ticketId) },
      footerNote: "Replying to this email will reopen your ticket.",
      logoUrl: data.logoUrl,
    }),
  };
}

/* ------------------------------------------------------------------ */
/* Client portal invites & registration                                */
/* ------------------------------------------------------------------ */

function longDate(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });
}

export type ClientInviteEmailData = {
  orgName: string;
  email: string;
  inviteUrl: string;
  expiresAt?: string | null;
  invitedByName?: string | null;
  logoUrl?: string;
};

/** Sent to a client when the team creates a portal invite. */
export function clientInviteEmail(data: ClientInviteEmailData): EmailContent {
  const invitedBy = data.invitedByName ? `${esc(data.invitedByName)} at ` : "";
  return {
    subject: `You're invited to the ${data.orgName} support portal`,
    html: layout({
      preheader: `Set up your client portal account for ${data.orgName}.`,
      heading: "Set up your client portal",
      intro: `${invitedBy}<strong>${esc(data.orgName)}</strong> uses Rabbit 365 to manage support and maintenance. Create your account to raise requests and follow progress.`,
      content: detailTable([
        { label: "Company", value: data.orgName },
        { label: "Email", value: data.email },
        { label: "Invite expires", value: longDate(data.expiresAt) },
      ]),
      cta: { label: "Accept invite", url: data.inviteUrl },
      footerNote:
        "If you weren't expecting this invite, you can safely ignore this email. The link is single-use and expires automatically.",
      logoUrl: data.logoUrl,
    }),
  };
}

export type PasswordResetEmailData = {
  resetUrl: string;
  portal: "admin" | "client";
  email?: string;
  logoUrl?: string;
};

/** Sent when an admin or client requests a password reset. */
export function passwordResetEmail(data: PasswordResetEmailData): EmailContent {
  const account = data.portal === "admin" ? "admin portal" : "support portal";
  return {
    subject: "Reset your Rabbit 365 password",
    html: layout({
      preheader: `Reset the password for your Rabbit 365 ${account}.`,
      heading: "Reset your password",
      intro: `We received a request to reset the password for your Rabbit 365 <strong>${account}</strong>. Click the button below to choose a new password.`,
      content: detailTable([
        { label: "Account", value: data.email },
        { label: "Portal", value: data.portal === "admin" ? "Admin portal" : "Client support portal" },
      ]),
      cta: { label: "Choose a new password", url: data.resetUrl },
      footerNote:
        "This link expires automatically and can only be used once. If you didn't request a password reset, you can safely ignore this email  -  your password will not change.",
      logoUrl: data.logoUrl,
    }),
  };
}

export type ClientRegisteredTeamData = {
  orgName: string;
  userName?: string | null;
  email: string;
  registeredAt: string;
  portalUrl: string;
  logoUrl?: string;
};

/** Sent to the Rabbit 365 team when a client completes portal registration. */
export function clientRegisteredTeamEmail(data: ClientRegisteredTeamData): EmailContent {
  return {
    subject: `Client registered  -  ${data.orgName}`,
    html: layout({
      preheader: `${data.email} just joined the ${data.orgName} portal.`,
      heading: "A client just registered",
      intro: `<strong>${esc(data.userName || data.email)}</strong> created a portal account for <strong>${esc(data.orgName)}</strong>.`,
      content: detailTable([
        { label: "Company", value: data.orgName },
        { label: "Name", value: data.userName },
        { label: "Email", value: data.email },
        { label: "Registered", value: longDate(data.registeredAt) },
      ]),
      cta: { label: "Open client in portal", url: data.portalUrl },
      footerNote: "You can manage this client's sites, users and tickets from the admin portal.",
      logoUrl: data.logoUrl,
    }),
  };
}

export type FuneralOutreachEmailData = {
  businessName: string;
  observation: string;
  logoUrl?: string;
};

/** Outreach email for funeral parlour website services. */
export function funeralOutreachEmail(data: FuneralOutreachEmailData): EmailContent {
  const businessName = data.businessName.trim() || "[Business Name]";
  const observation = data.observation.trim() || "[Your observation about their business]";
  const intro =
    `My name is Sam, representing <strong>Rabbit 365</strong>, a web design and digital solutions company based in South Africa.` +
    `<br /><br />We came across ${esc(businessName)} and were impressed by ${esc(observation)}.` +
    `<br /><br />We would like to introduce our services and explore an opportunity to help strengthen your business's online presence.` +
    `<br /><br />We build custom websites, web applications, and mobile applications using industry-standard technologies. Our solutions are professional, mobile-friendly, and designed to help businesses showcase their services, reach more customers, and generate enquiries.`;

  const features = [
    "Professional website design tailored to your brand.",
    "Funeral plans, packages and benefits display.",
    "Funeral services and company information.",
    "Online quotation and enquiry forms.",
    "WhatsApp integration for direct customer communication.",
    "Funeral notices and announcements.",
    "Online registration functionality.",
    "Google Maps and social media integration.",
    "Frequently asked questions and contact information.",
  ];
  const content =
    sectionHeading("Some of the features we can offer include") +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;border:1px solid ${COLOR.border};border-radius:14px;background:${COLOR.panel}"><tr><td style="padding:20px 24px"><ul style="margin:0;padding-left:20px;color:${COLOR.body};font-size:15px;line-height:28px">${features
      .map((item) => `<li style="margin:0 0 10px;padding-left:2px">${esc(item)}</li>`)
      .join("")}</ul></td></tr></table>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px"><tr><td style="padding:18px 20px;background:#ECFDF5;border:1px solid #A7F3D0;border-radius:14px"><p style="margin:0;font-size:15px;line-height:26px;color:#065F46"><strong>Website development packages start from R6,500</strong>, with more comprehensive solutions ranging from <strong>R8,000 to R10,000+</strong>, depending on the required features and functionality.</p></td></tr></table>` +
    `<p class="rb-text" style="margin:0 0 14px;font-size:16px;line-height:28px;color:${COLOR.body}">We would appreciate the opportunity to discuss your business requirements and explore how Rabbit 365 could contribute to your digital growth.</p>` +
    `<p class="rb-text" style="margin:0;font-size:16px;line-height:28px;color:${COLOR.body}">Please let us know if you would be open to a brief meeting or call.</p>`;

  return {
    subject: `Website design for ${businessName}`,
    html: layout({
      preheader: `Rabbit 365 website design services for ${businessName}.`,
      heading: `Good day ${businessName} Team,`,
      intro,
      content,
      footerNote:
        "Thank you for your time and consideration.<br /><br />Kind regards,<br /><br /><strong style=\"color:#0F172A;font-size:15px\">Sam</strong><br /><span style=\"color:#334155\">Rabbit 365</span><br /><span style=\"color:#64748B\">Web Design &amp; Digital Solutions</span>",
      logoUrl: data.logoUrl,
    }),
  };
}


export function mfaOtpEmail(data: { code: string; purpose: "login" | "verify"; logoUrl?: string }): EmailContent {
  const purposeText = data.purpose === "login" ? "sign in to Rabbit 365 Admin" : "verify your email MFA method";
  return {
    subject: data.code + " is your Rabbit 365 verification code",
    html: layout({
      preheader: "Your Rabbit 365 verification code is " + data.code + ".",
      heading: "Your verification code",
      intro: "Use this code to " + purposeText + ". It expires in 10 minutes.",
      content: '<div style="margin:0 0 24px;padding:24px;border:1px solid ' + COLOR.border + ';border-radius:14px;background:' + COLOR.panel + ';text-align:center"><div style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:' + COLOR.muted + ';margin-bottom:8px">One-time code</div><div style="font-size:40px;line-height:1;font-weight:800;letter-spacing:.18em;color:' + COLOR.ink + '">' + esc(data.code) + '</div></div><p style="margin:0;font-size:14px;line-height:22px;color:' + COLOR.muted + '">If you did not request this code, you can ignore this email.</p>',
      logoUrl: data.logoUrl,
    }),
  };
}
