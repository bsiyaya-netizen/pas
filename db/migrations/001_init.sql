-- Brokers, clients and underwriters. Brokers are FSCA-authorised FSPs.
create table brokers (
  id text primary key,
  name text not null,
  fsp_number text not null unique,
  created_at timestamptz not null default now()
);

create table clients (
  id text primary key,
  broker_id text not null references brokers (id),
  name text not null,
  created_at timestamptz not null default now()
);
create index clients_broker_idx on clients (broker_id);

create table underwriters (
  id text primary key,
  name text not null,
  authority integer not null check (authority > 0),
  created_at timestamptz not null default now()
);

-- A quote is stored whole as a JSON document (options, ratings, referrals);
-- the columns beside it are copies for querying and access control.
-- revision guards against two people changing the same quote at once.
create table quotes (
  id text primary key,
  broker_id text not null references brokers (id),
  client_id text not null references clients (id),
  line text not null,
  status text not null check (status in ('open', 'bound')),
  expires_on date not null,
  revision integer not null default 1,
  document jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null default now()
);
create index quotes_broker_idx on quotes (broker_id, created_at desc);

create sequence policy_number_seq;

-- One policy per quote, enforced by the unique quote_id.
create table policies (
  policy_number text primary key,
  quote_id text not null unique references quotes (id),
  broker_id text not null references brokers (id),
  client_id text not null references clients (id),
  product_id text not null,
  insurer text not null,
  line text not null,
  status text not null,
  revision integer not null default 1,
  document jsonb not null,
  created_at timestamptz not null default now()
);
create index policies_broker_idx on policies (broker_id);

-- Append-only log of every change to every policy.
create table policy_transactions (
  id text primary key,
  policy_number text not null references policies (policy_number),
  type text not null,
  effective_date date not null,
  processed_at timestamptz not null,
  premium_delta bigint not null,
  processed_by text not null
);
create index policy_transactions_policy_idx on policy_transactions (policy_number, processed_at);
