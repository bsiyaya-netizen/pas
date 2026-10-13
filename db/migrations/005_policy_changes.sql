-- Endorsements and cancellations: the one-off amount for the rest of the month
-- (positive owed by the client, negative returned) and a description of the change.
alter table policy_transactions add column pro_rata_adjustment bigint not null default 0;
alter table policy_transactions add column description text;
