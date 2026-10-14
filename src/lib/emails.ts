/**
 * Central email templates for Rabbit 365.
 *
 * All transactional email HTML lives here. Resend is only the transport
 * (see `lib/resend.ts`); it does NOT store these templates. Edit this file to
 * change what customers and the team receive.
 *
 * Preview them locally at: /dev/emails  (dev only, see routes/dev.ts)
 */

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
 * so emails never depend on the marketing site being reachable. Pass APP_URL.
 */
export function brandLogoUrl(baseUrl?: string): string {
  const base = (baseUrl || BRAND.site).replace(/\/$/, "");
  return `${base}/api/assets/logo.png`;
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
};

function layout(input: LayoutInput): string {
  const year = new Date().getFullYear();
  const logoUrl = input.logoUrl || BRAND.logo;
  const intro = input.intro
    ? `<p style="margin:0 0 22px;font-size:15px;line-height:24px;color:${COLOR.body}">${input.intro}</p>`
    : "";
  const cta = input.cta ? button(input.cta.label, input.cta.url) : "";
  const footerNote = input.footerNote
    ? `<p style="margin:24px 0 0;font-size:13px;line-height:21px;color:${COLOR.muted}">${input.footerNote}</p>`
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
    @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap');
    body { margin:0; padding:0; width:100% !important; background:${COLOR.bg}; }
    a { text-decoration:none; }
    table { border-collapse:collapse; }
    @media (max-width:600px) {
      .rb-card { width:100% !important; border-radius:0 !important; }
      .rb-pad { padding-left:22px !important; padding-right:22px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:${COLOR.bg};font-family:${FONT_STACK};-webkit-font-smoothing:antialiased">
  <div style="display:none;font-size:1px;color:${COLOR.bg};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">${esc(
    input.preheader,
  )}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLOR.bg}">
    <tr>
      <td align="center" style="padding:36px 16px">
        <table role="presentation" class="rb-card" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 6px 24px rgba(15,23,42,.06)">
          <tr><td style="height:5px;line-height:5px;font-size:0;background:${COLOR.mint}">&nbsp;</td></tr>
          <tr>
            <td class="rb-pad" style="padding:28px 36px 20px;border-bottom:1px solid ${COLOR.border}">
              <img src="${logoUrl}" alt="${BRAND.name}" height="40" style="height:40px;display:block;border:0;outline:none;text-decoration:none" />
            </td>
          </tr>
          <tr>
            <td class="rb-pad" style="padding:34px 36px 36px">
              <h1 style="margin:0 0 14px;font-size:23px;line-height:31px;font-weight:800;color:${COLOR.ink}">${esc(
                input.heading,
              )}</h1>
              ${intro}
              ${input.content}
              ${cta}
              ${footerNote}
            </td>
          </tr>
          <tr>
            <td class="rb-pad" style="background:${COLOR.charcoal};padding:30px 36px">
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
    subject: `New enquiry: ${lead.category ?? "general"} — ${lead.name}`,
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
    subject: `Quotation accepted: ${data.quoteNumber} — ${data.title}`,
    html: layout({
      preheader: `${data.acceptedByName} accepted ${data.quoteNumber}.`,
      heading: "Quotation accepted",
      intro: "Good news — a client has accepted a quotation. Reach out to confirm the next steps.",
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
    subject: `Thank you — quotation ${data.quoteNumber} accepted`,
    html: layout({
      preheader: `We've received your acceptance of ${data.quoteNumber}.`,
      heading: `Thank you, ${data.clientName}!`,
      intro:
        "We've received your acceptance of the quotation below. Our team will be in touch shortly to get started.",
      content: banner("Quotation accepted") + detailTable(rows),
      cta: data.quotationUrl ? { label: "View your quotation", url: data.quotationUrl } : undefined,
      footerNote:
        "If you did not accept this quotation, please reply to this email and let us know.",
      logoUrl: data.logoUrl,
    }),
  };
}
