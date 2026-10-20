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
- Split: 80/10/10 with seed 42. TabPFN is fitted on train plus validation,
  which is 37,498 rows.
- Game cards are drawn only from the 4,167 held-out test listings. TabPFN
  never saw any restaurant a player is shown.

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
| `site/app.js` | Game logic, scoring, procedural map, local save of progress. |
| `site/data/samples.js` | Generated listings plus TabPFN predictions. |

The map is decorative. Streets, parks and neighbouring places are generated
from a seed per restaurant. They are not real locations. The page uses no
third-party map service or branding.
