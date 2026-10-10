-- The server functions (Drive archive, nightly backup, member creation, push) run as `service_role`.
-- Hosted projects created with "Automatically expose new tables" switched off give that role no table
-- privileges at all, so every server function that reads the database failed with 42501. Grant it
-- explicitly. service_role bypasses row-level security by design; it is a server-only key and is never
-- sent to a browser. anon and authenticated keep their narrow explicit grants.
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;
