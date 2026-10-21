"""Precompute TabPFN predictions for the "Can you beat TabPFN?" game.

Follows the Prior Labs cookbook "Predict Restaurant Ratings with TabPFN 3.5":
https://docs.priorlabs.ai/cookbook/zomato_model_comparison

Same data (MulTaBench curated Zomato Bangalore listings) and model setup, with
one change: the 90/10 train/test split is made by restaurant, not by row. The
dataset lists each restaurant 4 to 5 times (once per area and category, almost
always with the same rating). A row split puts 95% of test restaurants into the
training data too, and a plain lookup of the training rating then scores MAE
0.011. Splitting by restaurant (name + address) means TabPFN has never seen any
restaurant the player is shown, under any listing.

Backends
--------
api   (default, matches the cookbook): tabpfn-client TabPFN 3.5 regressor,
      raw columns, reviews truncated to 1,000 characters. Needs TABPFN_TOKEN.
local : open-source `tabpfn` package with the locally cached TabPFN v3
      checkpoint. Local TabPFN does not embed free text, so the long text
      columns are replaced by parsed numeric review statistics.

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
from sklearn.model_selection import GroupShuffleSplit

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


SPLIT = "by-restaurant-v1"  # stored with cached predictions; bump when the split changes


def restaurant_key(df: pd.DataFrame) -> pd.Series:
    """One key per physical restaurant: the same name at the same address."""
    norm = lambda col: df[col].astype(str).str.lower().str.replace(r"\s+", " ", regex=True).str.strip()
    return norm("name") + " | " + norm("address")


def split(df: pd.DataFrame):
    """90/10 split with every listing of a restaurant on the same side."""
    keys = restaurant_key(df)
    splitter = GroupShuffleSplit(n_splits=1, test_size=0.1, random_state=SEED)
    tv_idx, te_idx = next(splitter.split(df, groups=keys))
    train_valid, test = df.iloc[tv_idx], df.iloc[te_idx]
    leaked = set(keys.iloc[te_idx]) & set(keys.iloc[tv_idx])
    assert not leaked, f"{len(leaked)} restaurants appear in both train and test"
    return train_valid, test


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


# ------------------------------------------------------------------------ export
def card(row: pd.Series, pred: float) -> dict:
    reviews = parse_reviews(row["reviews_list"])
    # Every written review, in full. The scrape repeats many reviews verbatim.
    shown = list({(s, t): {"stars": s, "text": t} for s, t in reviews if t}.values())
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
        "tabpfn": round(float(pred), 2),  # shown to 2 decimals, so score on the same value
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

    t0 = time.time()
    cache = DATA_DIR / f"preds_{args.backend}.json"
    if args.reuse and cache.exists():
        cached = json.loads(cache.read_text())
        if cached.get("split") != SPLIT or cached.get("test_ids") != [int(i) for i in test.index]:
            raise SystemExit(f"{cache} was made with a different split. Run again without --reuse.")
        preds, model_name = np.array(cached["preds"]), cached["model"]
    else:
        preds, model_name = (predict_api if args.backend == "api" else predict_local)(train_valid, test)
        cache.write_text(json.dumps({
            "model": model_name, "split": SPLIT,
            "test_ids": [int(i) for i in test.index], "preds": [float(p) for p in preds],
        }))
    y = test["rate"].to_numpy()
    metrics = {
        "r2": float(r2_score(y, preds)),
        "rmse": float(root_mean_squared_error(y, preds)),
        "mae": float(mean_absolute_error(y, preds)),
        "nTest": int(len(y)),
        "nTrain": int(len(train_valid)),
    }
    print(f"{model_name}: {metrics}  ({time.time() - t0:.0f}s)")

    test = test.assign(_pred=preds)
    # One card per restaurant, so a game never shows the same place twice.
    # Random subset of those; the site shuffles it again.
    unique = test[~restaurant_key(test).duplicated()]
    sample = unique.sample(n=min(args.n_samples, len(unique)), random_state=SEED)
    cards = [card(r, r["_pred"]) for _, r in sample.iterrows()]

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    payload = {"model": model_name, "metrics": metrics, "samples": cards}
    OUT_FILE.write_text(
        "// Generated by precompute.py. Do not edit by hand.\n"
        "window.GAME_DATA = " + json.dumps(payload, ensure_ascii=False) + ";\n",
        encoding="utf-8",
    )
    print(f"wrote {len(cards)} samples to {OUT_FILE}")


if __name__ == "__main__":
    main()
