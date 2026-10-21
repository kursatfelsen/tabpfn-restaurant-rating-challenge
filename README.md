# Beat TabPFN: Rate the Restaurant

A small web game. Players see a real Bangalore restaurant listing, styled like a
maps place page, and guess its Zomato rating. After each guess they see the real
rating and TabPFN's prediction. A live scoreboard tracks MAE and RMSE for
both players.

The data and modelling follow the Prior Labs cookbook
[Predict Restaurant Ratings with TabPFN 3.5](https://docs.priorlabs.ai/cookbook/zomato_model_comparison):

- Dataset: the MulTaBench curated version of the
  [Zomato Bangalore Restaurants](https://www.kaggle.com/datasets/himanshupoddar/zomato-bangalore-restaurants)
  dataset, with 41,665 rated listings.
- Split: 90/10 train/test with seed 42, **grouped by restaurant** (name +
  address). TabPFN is fitted on the 37,381 training rows.
- Game cards are drawn only from the 951 held-out test restaurants, one card
  per restaurant. TabPFN never saw any of them, under any listing.

### Why the split is by restaurant

The dataset lists each restaurant 4 to 5 times, once per area and category,
almost always with the same rating. There are 41,665 rows but only 9,504
restaurants. The cookbook's row split (`train_test_split`) puts 95% of test
restaurants into the training data as well. On that split, just looking up a
restaurant's training rating gets MAE 0.011, and TabPFN got 0.016. That was
mostly recall, not prediction. `split()` in `precompute.py` uses
`GroupShuffleSplit` and fails if any restaurant ends up on both sides.

## Scoring

Rating prediction is a regression task, so both players are scored on error.
Lower is better.

- **MAE** is the mean absolute error. It is the headline number.
- **RMSE** is the root mean squared error. It punishes big misses more than MAE.
- **Round winner** is whoever is closer to the real rating.

## Run it

```bash
python3 -m http.server 8000 --directory site
# open http://localhost:8000
```

The site is fully static. Predictions live in `site/data/samples.js`, so it can
be hosted on any static host, such as GitHub Pages, Netlify or S3.

## Modes and leaderboards

- **Free play** is endless. A score can be posted after 30 rounds, with an optional name, and the
  board keeps each player's best MAE.
- **Daily 10** gives everyone the same 10 restaurants, picked from the UTC
  date. There is one attempt per day. A finished run is posted as "Anonymous" right away, and the player can add a name later. The score itself is final. The result screen shows your error and TabPFN's for each round, and has buttons to share the score as text or as an image.

Both boards are stored in Supabase. To connect them:

1. Create a free project at [supabase.com](https://supabase.com).
2. Open the **SQL editor**, paste `supabase/schema.sql` and run it.
3. Copy the project URL and the anon or publishable key from
   **Project Settings → API** into `site/config.js`.

The key is public by design. The `scores` table isn't readable or writable
with it. The browser can only call `submit_score`, which validates the input,
and `get_leaderboard`, which never returns player ids. Each browser gets a
random player id, and only that browser can update its own row.

Scores are computed in the browser, and the true ratings ship with the page,
so a determined player can fake a score. That's acceptable for a fun board,
but it isn't proof of skill.

## Deploy to GitHub Pages

`.github/workflows/pages.yml` publishes the `site/` folder on every push to
`main` that touches `site/`. One-time setup: in the repo, open
**Settings → Pages** and set **Source** to **GitHub Actions**. The game is then
served at `https://<owner>.github.io/<repo>/`. All asset paths are relative, so
it also works under a custom domain.

## Regenerate predictions

```bash
uv venv .venv && uv pip install --python .venv/bin/python tabpfn-client tabpfn "scikit-learn==1.6.1" "pandas==2.3.3"

# Cookbook setup: TabPFN 3.5 through the API. Needs an API key from https://platform.priorlabs.ai/account/api-keys.
TABPFN_TOKEN=... .venv/bin/python precompute.py --backend api

# Offline fallback: open-source TabPFN v3 on your own machine.
.venv/bin/python precompute.py --backend local
```

Options:

- `--n-samples N` sets how many test listings ship to the site. The default is 400.
- `--reuse` re-exports from cached predictions in `data/preds_<backend>.json`
  without refitting.

### Backend differences

The **api** backend is the cookbook recipe. It uses the TabPFN 3.5 regressor
with 8 estimators on the raw columns, with reviews truncated to 1,000
characters. The API embeds the text columns itself.

The **local** backend uses the open-source `tabpfn` package with the TabPFN v3
checkpoint. Local TabPFN does not embed long free text by default. The script
therefore replaces the text columns with numeric summaries of the reviews, such
as review count, mean and spread of review scores, and counts of dishes and menu
items. Expect it to be less accurate than the API model.

## Files

| Path | What it is |
| --- | --- |
| `precompute.py` | Loads data, reproduces the cookbook split, runs TabPFN, exports game data. |
| `site/index.html` | Page layout: scoreboard, place panel, map, guess card. |
| `site/style.css` | Maps-style look. |
| `site/app.js` | Game logic, modes, scoring, leaderboards, procedural map, local save of progress. |
| `site/data/samples.js` | Generated listings plus TabPFN predictions. |
| `site/config.js` | Supabase URL and public key for the leaderboards. |
| `supabase/schema.sql` | Leaderboard table and functions. Run once in Supabase. |

The map is decorative. Streets, parks and neighbouring places are generated
from a seed per restaurant. They are not real locations. The page uses no
third-party map service or branding.
