-- Underwriters work for one insurer and may only decide that insurer's referrals.
alter table underwriters add column insurer text not null default '';
alter table underwriters alter column insurer drop default;
