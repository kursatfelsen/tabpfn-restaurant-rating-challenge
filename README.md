# Beat TabPFN: Rate the Restaurant

A small web game. Players see a real Bangalore restaurant listing, styled like a
maps place page, and guess its Zomato rating. After each guess they see the real
rating and the predictions of three models: TabPFN, XGBoost and Linear
Regression. A live scoreboard tracks MAE and RMSE for the player and each
model, plus the player's head-to-head record against each model.

The data and modelling follow the Prior Labs cookbook
[Predict Restaurant Ratings with TabPFN 3.5](https://docs.priorlabs.ai/cookbook/zomato_model_comparison),
with one deliberate change to the split:

- Dataset: the MulTaBench curated version of the
  [Zomato Bangalore Restaurants](https://www.kaggle.com/datasets/himanshupoddar/zomato-bangalore-restaurants)
  dataset, with 41,665 rated listings.
- Split: 10% held out with seed 42, **grouped by restaurant** (name plus
  address). The raw data lists most restaurants several times, once per
  "listed in" type and city, and 85% of restaurants have the same rating on
  every listing. The cookbook's row-level split therefore puts 95% of test
  restaurants into train as well, and a model can look the rating up by name.
  With the grouped split, all models are fitted on 37,384 listings and tested
  on 4,281 listings of restaurants they have never seen. Scores are lower than
  the cookbook's for that reason.
- Game cards are drawn only from the held-out test listings.

## Opponents

All three are fitted on the same training rows.

| Model | Features |
| --- | --- |
| **TabPFN** | See [Backend differences](#backend-differences). |
| **XGBoost** | The cookbook's default XGBoost: TF-IDF on reviews, menu and liked dishes (20k uni- and bigrams), one-hot categoricals, median-imputed numerics. |
| **Linear Regression** | The same features as XGBoost, fitted with ridge-regularised least squares. Plain least squares is ill-posed on about 20k sparse columns. The ridge alpha is picked on a grouped validation split. |

Model predictions are clipped to the observed rating range.

## Scoring

Rating prediction is a regression task, so everyone is scored on error.
Lower is better.

- **MAE** is the mean absolute error. It is the headline number.
- **RMSE** is the root mean squared error. It punishes big misses more than MAE.
- **Head-to-head:** each round the player beats every model whose prediction is
  further from the real rating than the guess.

## Run it

```bash
python3 -m http.server 8000 --directory site
# open http://localhost:8000
```

The site is fully static. Predictions live in `site/data/samples.js`, so it can
be hosted on any static host, such as GitHub Pages, Netlify or S3.

## Regenerate predictions

```bash
uv venv .venv && uv pip install --python .venv/bin/python tabpfn-client tabpfn xgboost "scikit-learn==1.6.1" "pandas==2.3.3"

# Cookbook setup: TabPFN 3.5 through the API. Needs an API key from ux.priorlabs.ai.
TABPFN_TOKEN=... .venv/bin/python precompute.py --backend api

# Offline fallback: open-source TabPFN v3 on your own machine.
.venv/bin/python precompute.py --backend local
```

Options:

- `--n-samples N` sets how many test listings ship to the site. The default is 400.
- `--reuse` re-exports from cached predictions in `data/preds_<backend>.json`
  and `data/preds_baselines.json` without refitting. A cache made for a
  different split is ignored and the model is refitted.

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
| `precompute.py` | Loads data, makes the grouped split, fits TabPFN, XGBoost and Linear Regression, exports game data. |
| `site/index.html` | Page layout: scoreboard, place panel, map, guess card. |
| `site/style.css` | Maps-style look. |
| `site/app.js` | Game logic, scoring, procedural map, local save of progress. |
| `site/data/samples.js` | Generated listings plus each model's predictions and test metrics. |

The map is decorative. Streets, parks and neighbouring places are generated
from a seed per restaurant. They are not real locations. The page uses no
third-party map service or branding.
