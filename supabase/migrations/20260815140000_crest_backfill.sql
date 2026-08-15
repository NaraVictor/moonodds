-- Crest and badge artwork.
--
-- API-Football publishes these on a public CDN at a path derived entirely from
-- the entity id, so every row that already carries a real external_id can be
-- given its artwork without a single API call or a key. New rows get theirs
-- from the fetch pipeline; this is purely for what is already on disk.
--
-- Rows without an external_id are left null on purpose — those are leagues and
-- teams created by hand in the Office, which have no upstream counterpart. The
-- UI falls back to a monogram for them, which is the correct outcome rather
-- than a broken image.

update leagues
   set logo = 'https://media.api-sports.io/football/leagues/'
              || external_id || '.png'
 where external_id is not null
   and logo is null;

update teams
   set logo = 'https://media.api-sports.io/football/teams/'
              || external_id || '.png'
 where external_id is not null
   and logo is null;
