-- Custom SQL migration file, put your code below! --
create extension if not exists pgcrypto;
create extension if not exists vector;
create extension if not exists pg_trgm;
create extension if not exists btree_gin;

-- Postgres 16 has no native uuidv7(); this derives a time-ordered UUID from a
-- random v4 (for entropy/variant bits) by overlaying a millisecond timestamp
-- and setting the version nibble to 7 (database.md §1.7, §3 id convention).
create or replace function uuid_generate_v7()
returns uuid
language sql
volatile
as $$
  select encode(
    set_bit(
      set_bit(
        overlay(
          uuid_send(gen_random_uuid())
          placing substring(int8send(floor(extract(epoch from clock_timestamp()) * 1000)::bigint) from 3)
          from 1 for 6
        ),
        52, 1
      ),
      53, 1
    ),
    'hex'
  )::uuid;
$$;