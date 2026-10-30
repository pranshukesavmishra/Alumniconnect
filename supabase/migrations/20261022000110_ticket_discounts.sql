-- Ticket discounts: the ticket keeps its real selling price in price_paise (every total, payment and receipt still uses it).
-- list_price_paise is the optional "original" price shown crossed out next to it; discount_label names the offer ("Early bird").
alter table public.event_ticket_types add column if not exists list_price_paise int;
alter table public.event_ticket_types add column if not exists discount_label text;

alter table public.event_ticket_types drop constraint if exists event_ticket_types_list_price_check;
alter table public.event_ticket_types add constraint event_ticket_types_list_price_check
  check (list_price_paise is null or list_price_paise > price_paise);

alter table public.event_ticket_types drop constraint if exists event_ticket_types_discount_label_check;
alter table public.event_ticket_types add constraint event_ticket_types_discount_label_check
  check (discount_label is null or char_length(discount_label) between 1 and 40);
