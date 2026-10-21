-- Beat TabPFN leaderboard. Paste into the Supabase SQL editor and run once.
--
-- The browser never touches the table directly. It calls two functions:
--   submit_score    : validates and upserts one row per player, mode and day.
--   get_leaderboard : returns the ranked board without exposing player ids.
-- player_id is a random UUID kept in the player's browser. It works like a
-- private token: only that browser can update its own row.

create table if not exists public.scores (
  id         bigint generated always as identity primary key,
  player_id  uuid        not null,
  name       text        not null check (char_length(name) between 1 and 24),
  mode       text        not null check (mode in ('challenge', 'endless')),
  day        date,
  rounds     int         not null check (rounds between 1 and 100000),
  mae        numeric(6, 4) not null check (mae between 0 and 4),
  rmse       numeric(6, 4) not null check (rmse between 0 and 4),
  wins       int         not null check (wins between 0 and rounds),
  bot_mae    numeric(6, 4) check (bot_mae between 0 and 4),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Challenge rows belong to a day. Free-play rows do not.
  check ((mode = 'challenge') = (day is not null))
);

create unique index if not exists scores_player_mode_day
  on public.scores (player_id, mode, coalesce(day, '1900-01-01'::date));
create index if not exists scores_board on public.scores (mode, day, mae, rounds desc);

alter table public.scores enable row level security;
revoke all on public.scores from anon, authenticated;

-- ---------------------------------------------------------------- submit
create or replace function public.submit_score(
  p_player uuid, p_name text, p_mode text, p_day date,
  p_rounds int, p_mae numeric, p_rmse numeric, p_wins int, p_bot_mae numeric
)
returns table (rank_pos bigint, total bigint, best_mae numeric, improved boolean)
language plpgsql security definer set search_path = public as $$
declare
  v_name     text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_day      date := case when p_mode = 'challenge' then p_day end;
  v_today    date := (now() at time zone 'utc')::date;
  v_prev     numeric;
  v_improved boolean := false;
begin
  if p_player is null then raise exception 'Missing player id'; end if;
  if char_length(v_name) not between 1 and 24 then
    raise exception 'Name must be 1 to 24 characters';
  end if;
  if p_mode = 'challenge' then
    if p_rounds <> 10 then raise exception 'A challenge run has exactly 10 rounds'; end if;
    -- One day of slack either side for time zones and runs that cross midnight.
    if v_day is null or v_day not between v_today - 1 and v_today + 1 then
      raise exception 'Challenge day is out of range';
    end if;
  elsif p_mode = 'endless' then
    if p_rounds < 30 then raise exception 'Play at least 30 rounds to submit'; end if;
  else
    raise exception 'Unknown mode';
  end if;

  select s.mae into v_prev from scores s
   where s.player_id = p_player and s.mode = p_mode and s.day is not distinct from v_day;

  if not found then
    insert into scores (player_id, name, mode, day, rounds, mae, rmse, wins, bot_mae)
    values (p_player, v_name, p_mode, v_day, p_rounds, p_mae, p_rmse, p_wins, p_bot_mae);
    v_improved := true;
  elsif p_mode = 'endless' and p_mae < v_prev then
    -- Free play keeps each player's best run.
    update scores s set name = v_name, rounds = p_rounds, mae = p_mae, rmse = p_rmse,
           wins = p_wins, bot_mae = p_bot_mae, updated_at = now()
     where s.player_id = p_player and s.mode = p_mode and s.day is null;
    v_improved := true;
  else
    -- A challenge score is final. Only the display name can change.
    update scores s set name = v_name
     where s.player_id = p_player and s.mode = p_mode and s.day is not distinct from v_day;
  end if;

  return query
    with b as (
      select s.player_id, s.mae,
             rank() over (order by s.mae, s.rounds desc) as r,
             count(*) over () as n
        from scores s
       where s.mode = p_mode and s.day is not distinct from v_day
    )
    select b.r, b.n, b.mae, v_improved from b where b.player_id = p_player;
end;
$$;

-- ----------------------------------------------------------------- read
create or replace function public.get_leaderboard(
  p_mode text, p_day date default null, p_player uuid default null, p_limit int default 50
)
returns table (rank_pos bigint, name text, rounds int, mae numeric, rmse numeric,
               wins int, bot_mae numeric, is_me boolean, total bigint)
language sql stable security definer set search_path = public as $$
  with b as (
    select s.*,
           rank() over (order by s.mae, s.rounds desc) as r,
           count(*) over () as n
      from scores s
     where s.mode = p_mode
       and s.day is not distinct from (case when p_mode = 'challenge' then p_day end)
  )
  select b.r, b.name, b.rounds, b.mae, b.rmse, b.wins, b.bot_mae,
         coalesce(b.player_id = p_player, false), b.n
    from b
   where b.r <= least(greatest(p_limit, 1), 200) or b.player_id = p_player
   order by b.r, b.created_at;
$$;

revoke execute on function public.submit_score(uuid, text, text, date, int, numeric, numeric, int, numeric) from public;
revoke execute on function public.get_leaderboard(text, date, uuid, int) from public;
grant execute on function public.submit_score(uuid, text, text, date, int, numeric, numeric, int, numeric) to anon, authenticated;
grant execute on function public.get_leaderboard(text, date, uuid, int) to anon, authenticated;
