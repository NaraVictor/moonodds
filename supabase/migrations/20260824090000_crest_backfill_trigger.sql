-- ---------------------------------------------------------------------------
-- Kicka, never store a league or team without artwork
--
-- The Office catalogue shows a badge beside every name, and three leagues came
-- back from the fixture fetch with a null logo. They render as a monogram,
-- which is a reasonable fallback and an unnecessary one: API-Football serves
-- this artwork from a CDN at a path derived purely from the entity id. No key,
-- no quota, no request. If we hold the id we can always produce the URL.
--
-- A trigger rather than a one-off UPDATE, because the gap reappears every time
-- a new competition arrives through a path that did not think to set it — and
-- the fixture pull creates leagues as a side effect of storing a match, which
-- is exactly such a path.
-- ---------------------------------------------------------------------------

create or replace function app.fill_crest()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.logo is null and new.external_id is not null then
    new.logo := 'https://media.api-sports.io/football/'
      || case tg_table_name when 'leagues' then 'leagues/' else 'teams/' end
      || new.external_id || '.png';
  end if;
  return new;
end;
$$;

drop trigger if exists fill_league_crest on leagues;
create trigger fill_league_crest
  before insert or update on leagues
  for each row execute function app.fill_crest();

drop trigger if exists fill_team_crest on teams;
create trigger fill_team_crest
  before insert or update on teams
  for each row execute function app.fill_crest();

-- Anything already stored without one.
update leagues set logo = logo where logo is null and external_id is not null;
update teams   set logo = logo where logo is null and external_id is not null;
