"""Precompute TabPFN predictions for the "Can you beat TabPFN?" game.

Follows the Prior Labs cookbook "Predict Restaurant Ratings with TabPFN 3.5":
https://docs.priorlabs.ai/cookbook/zomato_model_comparison

Same data (MulTaBench curated Zomato Bangalore listings) and the cookbook's
10% hold-out with SEED=42, with one change: the split is grouped by restaurant
(name + address). The raw data lists most restaurants several times with the
same rating, and the cookbook's row split puts ~95% of test restaurants into
train as well. The game only ever shows test listings, so no model saw any
listing of a restaurant the player is shown.

Backends
--------
api   (default, matches the cookbook): tabpfn-client TabPFN 3.5 regressor,
      raw columns, reviews truncated to 1,000 characters. Needs TABPFN_TOKEN.
local : open-source `tabpfn` package with the locally cached TabPFN v3
      checkpoint. Local TabPFN does not embed free text, so the long text
      columns are replaced by parsed numeric review statistics.

Baselines (always fitted, cached in data/preds_baselines.json)
---------
XGBoost           : the cookbook's default XGBoost on TF-IDF text + one-hot
                    categoricals + median-imputed numerics.
Linear Regression : the same features into ridge-regularised least squares,
                    alpha picked on the cookbook's validation split.

Usage
-----
    TABPFN_TOKEN=... python precompute.py --backend api
    python precompute.py --backend local
"""

from __future__ import annotations

import argparse
import ast
import json
import re
import time
from pathlib import Path
from urllib.request import urlretrieve
from zipfile import ZipFile

import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, r2_score, root_mean_squared_error

SEED = 42
ROOT = Path(__file__).parent
DATA_DIR = ROOT / "data"
OUT_FILE = ROOT / "site" / "data" / "samples.js"
COST = "approx cost(for two people)"
RATED_RE = re.compile(r"Rated\s+([0-9.]+)")


# --------------------------------------------------------------------------- data
def load_data() -> pd.DataFrame:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    csv = DATA_DIR / "data.csv"
    if not csv.exists():
        zip_path = DATA_DIR / "dataset.zip"
        urlretrieve(
            "https://www.kaggle.com/api/v1/datasets/download/chico89/"
            "multabench-zomato-restaurants?datasetVersionNumber=1",
            zip_path,
        )
        with ZipFile(zip_path) as archive:
            csv.write_bytes(archive.read("data.csv"))
    df = pd.read_csv(csv)
    assert len(df) == 41_665 and df["rate"].between(0, 5).all()
    df[COST] = pd.to_numeric(
        df[COST].astype(str).str.replace(",", "", regex=False), errors="coerce"
    )
    return df


def restaurant_groups(df: pd.DataFrame) -> pd.Series:
    """One group per physical restaurant. The raw data lists the same place
    several times (once per "listed_in" type and city), almost always with the
    same rating, so a plain row split leaks ~95% of test restaurants into train."""
    norm = lambda s: s.fillna("").str.lower().str.replace(r"\s+", " ", regex=True).str.strip()
    return norm(df["name"]) + "|" + norm(df["address"])


def group_split(df: pd.DataFrame, test_size: float):
    from sklearn.model_selection import GroupShuffleSplit

    gss = GroupShuffleSplit(n_splits=1, test_size=test_size, random_state=SEED)
    a, b = next(gss.split(df, groups=restaurant_groups(df)))
    return df.iloc[a], df.iloc[b]


def split(df: pd.DataFrame):
    # Cookbook proportions (10% held out, seed 42), but grouped by restaurant
    # so no test restaurant has any listing in train.
    return group_split(df, test_size=0.1)


def parse_reviews(raw) -> list[tuple[float | None, str]]:
    """reviews_list is a Python literal: [('Rated 4.0', 'RATED\\n  text'), ...]."""
    if not isinstance(raw, str) or raw in ("", "[]"):
        return []
    try:
        items = ast.literal_eval(raw)
    except (ValueError, SyntaxError):
        # Truncated or malformed literal: fall back to regex on the scores.
        return [(float(m), "") for m in RATED_RE.findall(raw)]
    out = []
    for item in items:
        if not isinstance(item, (tuple, list)) or len(item) != 2:
            continue
        score_txt, text = item
        m = RATED_RE.search(str(score_txt))
        score = float(m.group(1)) if m else None
        text = re.sub(r"^\s*RATED\s*", "", str(text)).strip()
        text = re.sub(r"\s+", " ", text)
        out.append((score, text))
    return out


def parse_list(raw) -> list[str]:
    if not isinstance(raw, str) or raw in ("", "[]"):
        return []
    try:
        v = ast.literal_eval(raw)
        return [str(x) for x in v] if isinstance(v, list) else []
    except (ValueError, SyntaxError):
        return []


# ------------------------------------------------------------------- api backend
def predict_api(train_valid: pd.DataFrame, test: pd.DataFrame) -> tuple[np.ndarray, str]:
    """Exactly the cookbook recipe for TabPFN 3.5 (no thinking)."""
    from tabpfn_client import TabPFNRegressor
    from tabpfn_client.api_models import ModelVersion

    X_tv = train_valid.drop(columns="rate")
    y_tv = train_valid["rate"].to_numpy()
    X_te = test.drop(columns="rate")
    X_tv = X_tv.assign(reviews_list=X_tv["reviews_list"].str.slice(stop=1_000))
    X_te = X_te.assign(reviews_list=X_te["reviews_list"].str.slice(stop=1_000))

    model = TabPFNRegressor.create_default_for_version(
        ModelVersion.V3_5, n_estimators=8, random_state=SEED
    )
    model.fit(X_tv, y_tv)
    return np.asarray(model.predict(X_te)), "TabPFN 3.5 (API)"


# ----------------------------------------------------------------- local backend
def local_features(frame: pd.DataFrame) -> pd.DataFrame:
    reviews = frame["reviews_list"].map(parse_reviews)
    scores = reviews.map(lambda r: [s for s, _ in r if s is not None])

    def stat(fn):
        return scores.map(lambda s: fn(s) if s else np.nan)

    feats = pd.DataFrame(
        {
            "votes": frame["votes"],
            "cost": frame[COST],
            "online_order": (frame["online_order"] == "Yes").astype(int),
            "book_table": (frame["book_table"] == "Yes").astype(int),
            "n_reviews": scores.map(len),
            "review_mean": stat(np.mean),
            "review_median": stat(np.median),
            "review_std": stat(np.std),
            "review_share_5": stat(lambda s: np.mean(np.array(s) >= 5)),
            "review_share_le2": stat(lambda s: np.mean(np.array(s) <= 2)),
            "n_dish_liked": frame["dish_liked"].fillna("").map(
                lambda s: len([x for x in s.split(",") if x.strip()])
            ),
            "n_menu_items": frame["menu_item"].map(lambda s: len(parse_list(s))),
            "n_cuisines": frame["cuisines"].fillna("").map(
                lambda s: len([x for x in s.split(",") if x.strip()])
            ),
            "location": frame["location"],
            "rest_type": frame["rest_type"],
            "listed_type": frame["listed_in(type)"],
            "listed_city": frame["listed_in(city)"],
            "cuisine_main": frame["cuisines"].fillna("").map(
                lambda s: s.split(",")[0].strip()
            ),
            "name": frame["name"],
        }
    )
    return feats


def predict_local(train_valid: pd.DataFrame, test: pd.DataFrame) -> tuple[np.ndarray, str]:
    import torch
    from tabpfn import TabPFNRegressor

    X_tv = local_features(train_valid)
    X_te = local_features(test)
    cat_cols = ["location", "rest_type", "listed_type", "listed_city", "cuisine_main", "name"]
    # Ordinal-encode categoricals with codes learned on the training rows.
    for c in cat_cols:
        cats = pd.Categorical(X_tv[c].fillna("NA")).categories
        X_tv[c] = pd.Categorical(X_tv[c].fillna("NA"), categories=cats).codes.astype(float)
        X_te[c] = pd.Categorical(X_te[c].fillna("NA"), categories=cats).codes.astype(float)
    X_te[cat_cols] = X_te[cat_cols].replace(-1, np.nan)
    cat_idx = [X_tv.columns.get_loc(c) for c in cat_cols]

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    # Use the already-downloaded v3 checkpoint so no license download is needed.
    ckpt = Path.home() / "Library/Caches/tabpfn/tabpfn-v3-regressor-v3_default.ckpt"
    model = TabPFNRegressor(
        model_path=str(ckpt) if ckpt.exists() else "auto",
        n_estimators=4,
        categorical_features_indices=cat_idx,
        device=device,
        ignore_pretraining_limits=True,
        random_state=SEED,
        memory_saving_mode=True,
    )
    model.fit(X_tv.to_numpy(dtype=float), train_valid["rate"].to_numpy())
    preds = []
    Xt = X_te.to_numpy(dtype=float)
    for i in range(0, len(Xt), 500):
        preds.append(model.predict(Xt[i : i + 500]))
        print(f"  predicted {min(i + 500, len(Xt))}/{len(Xt)}", flush=True)
    return np.concatenate(preds), "TabPFN v3 (local)"


# --------------------------------------------------------------------- baselines
TEXT_COLS = ["reviews_list", "menu_item", "dish_liked"]


def baseline_preprocessor(X: pd.DataFrame, scale_numeric: bool):
    """Cookbook XGBoost preprocessing: TF-IDF on the joined text columns,
    one-hot categoricals, median-imputed numerics."""
    from sklearn.compose import ColumnTransformer
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.impute import SimpleImputer
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import OneHotEncoder, StandardScaler

    cat_cols = [c for c in X.select_dtypes(exclude="number").columns if c != "text"]
    num_cols = X.select_dtypes(include="number").columns.tolist()
    numeric = SimpleImputer(strategy="median")
    if scale_numeric:
        numeric = make_pipeline(numeric, StandardScaler())
    return ColumnTransformer([
        ("text", TfidfVectorizer(max_features=20_000, ngram_range=(1, 2), min_df=3, sublinear_tf=True), "text"),
        ("categorical", OneHotEncoder(handle_unknown="ignore"), cat_cols),
        ("numeric", numeric, num_cols),
    ])


def baseline_frame(frame: pd.DataFrame) -> pd.DataFrame:
    X = frame.drop(columns=["rate", *TEXT_COLS])
    cat_cols = X.select_dtypes(exclude="number").columns
    X[cat_cols] = X[cat_cols].fillna("NA")
    return X.assign(text=frame[TEXT_COLS].fillna("").agg(" ".join, axis=1))


def predict_baselines(train_valid: pd.DataFrame, test: pd.DataFrame) -> dict[str, np.ndarray]:
    import xgboost as xgb
    from sklearn.linear_model import Ridge
    from sklearn.pipeline import make_pipeline

    X_tv, X_te = baseline_frame(train_valid), baseline_frame(test)
    y_tv = train_valid["rate"].to_numpy()
    lo, hi = y_tv.min(), y_tv.max()

    # Linear regression with a small ridge penalty. Plain least squares is
    # ill-posed on ~20k sparse TF-IDF + one-hot columns. Alpha is picked on
    # a validation split (1/9 of train+valid = 10% of all data), also grouped
    # by restaurant.
    tr, va = group_split(train_valid, test_size=1 / 9)
    best = None
    for alpha in (0.3, 1.0, 3.0, 10.0):
        m = make_pipeline(baseline_preprocessor(X_tv, True), Ridge(alpha=alpha))
        m.fit(baseline_frame(tr), tr["rate"].to_numpy())
        rmse = root_mean_squared_error(va["rate"], np.clip(m.predict(baseline_frame(va)), lo, hi))
        print(f"  ridge alpha={alpha}: valid RMSE {rmse:.4f}", flush=True)
        if best is None or rmse < best[0]:
            best = (rmse, alpha)
    linreg = make_pipeline(baseline_preprocessor(X_tv, True), Ridge(alpha=best[1]))
    linreg.fit(X_tv, y_tv)

    # Cookbook default XGBoost.
    pre = baseline_preprocessor(X_tv, False)
    Xt_tv = pre.fit_transform(X_tv)
    model = xgb.XGBRegressor(
        objective="reg:squarederror", eval_metric="rmse", tree_method="hist",
        device="cpu", n_jobs=8, random_state=SEED,
    )
    model.fit(Xt_tv, y_tv, verbose=False)

    return {
        "linreg": np.clip(linreg.predict(X_te), lo, hi),
        "xgb": np.clip(model.predict(pre.transform(X_te)), lo, hi),
    }


# ------------------------------------------------------------------------ export
def card(row: pd.Series, preds: dict[str, float]) -> dict:
    reviews = parse_reviews(row["reviews_list"])
    shown = [
        {"stars": s, "text": t[:420] + ("…" if len(t) > 420 else "")}
        for s, t in reviews
        if t
    ][:6]
    hist = [0, 0, 0, 0, 0]
    for s, _ in reviews:
        if s is not None and 1 <= s <= 5:
            hist[int(round(s)) - 1] += 1
    menu = list(dict.fromkeys(parse_list(row["menu_item"])))[:8]
    dish = [d.strip() for d in str(row["dish_liked"]).split(",")] if isinstance(row["dish_liked"], str) else []
    return {
        "id": int(row.name),
        "name": row["name"],
        "address": row["address"],
        "location": row["location"],
        "area": row["listed_in(city)"],
        "type": row["rest_type"] if isinstance(row["rest_type"], str) else None,
        "listed": row["listed_in(type)"],
        "cuisines": row["cuisines"],
        "cost": None if pd.isna(row[COST]) else int(row[COST]),
        "votes": int(row["votes"]),
        "online": row["online_order"] == "Yes",
        "booking": row["book_table"] == "Yes",
        "dishes": dish[:7],
        "menu": menu,
        "nReviews": len(reviews),
        "hist": hist,
        "reviews": shown,
        "rate": float(row["rate"]),
        "preds": {k: round(float(v), 3) for k, v in preds.items()},
    }


def metrics_for(y: np.ndarray, preds: np.ndarray) -> dict:
    return {
        "r2": float(r2_score(y, preds)),
        "rmse": float(root_mean_squared_error(y, preds)),
        "mae": float(mean_absolute_error(y, preds)),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--backend", choices=["api", "local"], default="api")
    ap.add_argument("--n-samples", type=int, default=400,
                    help="How many test listings to ship to the website.")
    ap.add_argument("--reuse", action="store_true",
                    help="Reuse cached predictions for this backend instead of refitting.")
    args = ap.parse_args()

    df = load_data()
    train_valid, test = split(df)
    print(f"train+valid: {len(train_valid):,}  test: {len(test):,}")

    # Caches record which test rows they cover, so a cache from another split is refused.
    test_index = [int(i) for i in test.index]

    def cached(path: Path):
        if not (args.reuse and path.exists()):
            return None
        c = json.loads(path.read_text())
        if c.get("index") != test_index:
            print(f"  ignoring {path.name}: made for a different split")
            return None
        return c

    t0 = time.time()
    cache = DATA_DIR / f"preds_{args.backend}.json"
    if c := cached(cache):
        preds, model_name = np.array(c["preds"]), c["model"]
    else:
        preds, model_name = (predict_api if args.backend == "api" else predict_local)(train_valid, test)
        cache.write_text(json.dumps({"model": model_name, "index": test_index, "preds": [float(p) for p in preds]}))
    y = test["rate"].to_numpy()
    print(f"{model_name}: {metrics_for(y, preds)}  ({time.time() - t0:.0f}s)")

    t0 = time.time()
    base_cache = DATA_DIR / "preds_baselines.json"
    if c := cached(base_cache):
        base = {k: np.array(v) for k, v in c["preds"].items()}
    else:
        base = predict_baselines(train_valid, test)
        base_cache.write_text(json.dumps({"index": test_index, "preds": {k: [float(p) for p in v] for k, v in base.items()}}))

    all_preds = {"tabpfn": preds, **base}
    names = {"tabpfn": model_name, "xgb": "XGBoost", "linreg": "Linear Regression"}
    models = []
    for key in ("tabpfn", "xgb", "linreg"):
        m = metrics_for(y, all_preds[key])
        print(f"{names[key]}: {m}")
        models.append({"key": key, "name": names[key], "metrics": m})
    print(f"baselines ({time.time() - t0:.0f}s)")

    # Random subset of the held-out test listings; the site shuffles it again.
    sample = test.sample(n=min(args.n_samples, len(test)), random_state=SEED)
    at = {idx: i for i, idx in enumerate(test_index)}
    cards = [card(r, {k: v[at[r.name]] for k, v in all_preds.items()}) for _, r in sample.iterrows()]

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "models": models,
        "nTest": int(len(y)),
        "nTrain": int(len(train_valid)),
        "samples": cards,
    }
    OUT_FILE.write_text(
        "// Generated by precompute.py. Do not edit by hand.\n"
        "window.GAME_DATA = " + json.dumps(payload, ensure_ascii=False) + ";\n",
        encoding="utf-8",
    )
    print(f"wrote {len(cards)} samples to {OUT_FILE}")


if __name__ == "__main__":
    main()
