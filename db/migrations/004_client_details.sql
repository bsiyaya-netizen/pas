-- Contact and identity details printed on policy documents. All optional, so
-- clients captured before this change stay valid until a broker completes them.
alter table clients add column id_number text;
alter table clients add column email text;
alter table clients add column phone text;
alter table clients add column address jsonb;
