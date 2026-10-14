-- =============================================================
-- Optional seed data — two example quotations.
-- Safe to skip. Run after the migrations if you want sample quotes.
-- =============================================================

insert into public.quotations (
  id, quote_number, title, project, status, currency,
  client_name, client_company, prepared_by, valid_until,
  terms, subtotal, discount, total, created_at, updated_at
) values
(
  '00000000-0000-0000-0000-000000000001',
  'R365-2026-0001',
  'INGCEBO-YH WEBSITE UPGRADE',
  'Website Product Catalogue, Inventory & Quotation Management System',
  'sent', 'R',
  'Mashiya', 'Ingcebo Yomndeni Holdings', 'Rabbit 365', '2026-03-14',
  array[
    'The quoted amount covers the development work and deliverables listed in this quotation.',
    'Any additional functionality or work outside the agreed scope will be quoted separately.',
    'The client will be responsible for future hosting, database usage, domain renewal and third-party service charges, where applicable.',
    'The project will initially use available free service tiers where suitable. Free-tier limits and service availability are subject to the providers'' terms.',
    'Ongoing maintenance, support and future enhancements are excluded unless agreed separately.',
    'Project commencement, payment milestones and delivery dates will be agreed upon before development begins.',
    'A 50% deposit is payable before the commencement of the work, unless otherwise negotiated and agreed.'
  ],
  14000, 6500, 7500, '2026-02-12T08:00:00Z', '2026-02-12T08:00:00Z'
),
(
  '00000000-0000-0000-0000-000000000002',
  'R365-2026-0002',
  'STARTER BUSINESS WEBSITE',
  '5-Page Responsive Business Website',
  'draft', 'R',
  'Sample Client', 'Demo Business (Pty) Ltd', 'Rabbit 365', '2026-03-20',
  array[
    'The quoted amount covers the development work and deliverables listed in this quotation.',
    'Any additional functionality or work outside the agreed scope will be quoted separately.',
    'The client will be responsible for future hosting, domain renewal and third-party service charges, where applicable.',
    'Ongoing maintenance, support and future enhancements are excluded unless agreed separately.',
    'Project commencement, payment milestones and delivery dates will be agreed upon before development begins.',
    'A 50% deposit is payable before the commencement of the work, unless otherwise negotiated and agreed.'
  ],
  10000, 0, 10000, '2026-02-20T08:00:00Z', '2026-02-20T08:00:00Z'
)
on conflict (id) do nothing;

insert into public.quotation_items (quotation_id, position, description, amount, kind) values
('00000000-0000-0000-0000-000000000001', 0, 'Regular development price', 14000, 'regular'),
('00000000-0000-0000-0000-000000000001', 1, 'Relationship discount', -6500, 'discount'),
('00000000-0000-0000-0000-000000000001', 2, 'Total project price', 7500, 'total'),
('00000000-0000-0000-0000-000000000002', 0, 'Website design & development', 8500, 'regular'),
('00000000-0000-0000-0000-000000000002', 1, 'Content setup & basic SEO', 1500, 'regular'),
('00000000-0000-0000-0000-000000000002', 2, 'Total project price', 10000, 'total')
on conflict do nothing;
