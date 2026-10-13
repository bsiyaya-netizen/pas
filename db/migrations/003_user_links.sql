-- Links a signed-in user (the identity provider's user id) to the broker or
-- underwriter they act for. Roles themselves come from the identity provider.
create table user_links (
  subject text primary key,
  broker_id text references brokers (id),
  underwriter_id text references underwriters (id),
  created_at timestamptz not null default now(),
  check ((broker_id is null) <> (underwriter_id is null))
);
