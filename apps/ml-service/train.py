import hashlib
import importlib.metadata
import json
import platform
from datetime import datetime, timezone
from pathlib import Path

import joblib
import pandas as pd
import sklearn
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score, precision_score, recall_score
from sklearn.model_selection import cross_validate, train_test_split, StratifiedKFold
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

from generate_synthetic_dataset import CLASSES, FIELDS, SEED, write_dataset

ROOT = Path(__file__).parent
DATASET = ROOT / "data" / "synthetic_cbc_v1.csv"
ARTIFACT = ROOT / "artifacts" / "medlab-synthetic-cbc-v1.joblib"
METADATA = ARTIFACT.with_suffix(".json")
NUMERIC_FEATURES = ["age_years", "hemoglobin_g_dl", "mcv_fl", "wbc_10e9_l", "platelets_10e9_l"]
CATEGORICAL_FEATURES = ["sex"]
FEATURES = NUMERIC_FEATURES + CATEGORICAL_FEATURES


def build_pipeline() -> Pipeline:
    preprocessing = ColumnTransformer(
        [
            ("numeric", "passthrough", NUMERIC_FEATURES),
            ("categorical", OneHotEncoder(handle_unknown="error"), CATEGORICAL_FEATURES),
        ],
        remainder="drop",
    )
    return Pipeline(
        [
            ("preprocessing", preprocessing),
            (
                "classifier",
                RandomForestClassifier(
                    n_estimators=250,
                    min_samples_leaf=2,
                    class_weight="balanced",
                    random_state=SEED,
                    n_jobs=1,
                ),
            ),
        ]
    )


def train() -> dict[str, object]:
    if not DATASET.exists():
        write_dataset(DATASET)
    raw = pd.read_csv(DATASET)
    if tuple(raw.columns) != FIELDS:
        raise ValueError("Synthetic training CSV has an unexpected schema")
    if raw.isnull().any().any() or set(raw["label"].unique()) != set(CLASSES):
        raise ValueError("Synthetic training CSV contains missing values or unexpected classes")
    x = raw[FEATURES]
    y = raw["label"]
    x_train, x_test, y_train, y_test = train_test_split(
        x, y, test_size=0.2, random_state=SEED, stratify=y
    )
    pipeline = build_pipeline()
    folds = StratifiedKFold(n_splits=5, shuffle=True, random_state=SEED)
    cv_scores = cross_validate(
        pipeline,
        x_train,
        y_train,
        cv=folds,
        scoring={"accuracy": "accuracy", "macro_f1": "f1_macro"},
        n_jobs=1,
        error_score="raise",
    )
    pipeline.fit(x_train, y_train)
    predicted = pipeline.predict(x_test)
    classes = [str(value) for value in pipeline.named_steps["classifier"].classes_]
    report = classification_report(y_test, predicted, labels=classes, output_dict=True, zero_division=0)
    metrics: dict[str, object] = {
        "held_out": {
            "accuracy": float(accuracy_score(y_test, predicted)),
            "precision_macro": float(precision_score(y_test, predicted, average="macro", zero_division=0)),
            "recall_macro": float(recall_score(y_test, predicted, average="macro", zero_division=0)),
            "f1_macro": float(f1_score(y_test, predicted, average="macro", zero_division=0)),
            "confusion_matrix": confusion_matrix(y_test, predicted, labels=classes).tolist(),
            "confusion_matrix_labels": classes,
            "per_class": {
                label: {
                    "precision": float(report[label]["precision"]),
                    "recall": float(report[label]["recall"]),
                    "f1": float(report[label]["f1-score"]),
                    "support": int(report[label]["support"]),
                }
                for label in classes
            },
        },
        "cross_validation_on_training_partition": {
            "folds": 5,
            "accuracy_mean": float(cv_scores["test_accuracy"].mean()),
            "accuracy_std": float(cv_scores["test_accuracy"].std()),
            "macro_f1_mean": float(cv_scores["test_macro_f1"].mean()),
            "macro_f1_std": float(cv_scores["test_macro_f1"].std()),
        },
    }
    ARTIFACT.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(pipeline, ARTIFACT, compress=3)
    dataset_hash = hashlib.sha256(DATASET.read_bytes()).hexdigest()
    metadata: dict[str, object] = {
        "model_version": "medlab-synthetic-cbc-v1",
        "model_type": "RandomForestClassifier",
        "dataset": {
            "name": "MedLab synthetic CBC pattern dataset",
            "synthetic": True,
            "rows": int(len(raw)),
            "sha256": dataset_hash,
            "label_method": "Deterministic, documented synthetic threshold rules; no random labels or patient data.",
        },
        "label_rules": [
            "synthetic_anemia_pattern: hemoglobin < 13.0 g/dL for MALE, < 12.0 for FEMALE, and < 12.5 for OTHER/UNKNOWN.",
            "synthetic_red_cell_index_pattern: otherwise, MCV < 80 fL or > 100 fL.",
            "synthetic_leukocyte_pattern: otherwise, WBC < 4 or > 11 x10^9/L.",
            "synthetic_platelet_pattern: otherwise, platelets < 150 or > 450 x10^9/L.",
            "within_synthetic_reference: none of the preceding synthetic threshold rules matched.",
            "Precedence is the order listed; these are synthetic labeling rules, not clinical reference ranges.",
        ],
        "training": {
            "random_seed": SEED,
            "train_test_split": {"test_size": 0.2, "stratified": True},
            "cross_validation": "5-fold stratified CV on the training partition; pipeline preprocessing is fit within each fold.",
            "trained_at_utc": datetime.now(timezone.utc).isoformat(),
            "python_version": platform.python_version(),
            "scikit_learn_version": sklearn.__version__,
            "dependencies": {
                name: importlib.metadata.version(name)
                for name in ("fastapi", "joblib", "numpy", "pandas", "python-dotenv", "scikit-learn", "uvicorn")
            },
        },
        "features": {
            "age_years": {"type": "integer", "minimum": 0, "maximum": 120},
            "sex": {"type": "category", "values": ["MALE", "FEMALE", "OTHER", "UNKNOWN"]},
            "hemoglobin_g_dl": {"type": "number", "minimum": 0, "maximum": 30},
            "mcv_fl": {"type": "number", "minimum": 0, "maximum": 200},
            "wbc_10e9_l": {"type": "number", "minimum": 0, "maximum": 500},
            "platelets_10e9_l": {"type": "number", "minimum": 0, "maximum": 5000},
        },
        "classes": classes,
        "metrics": metrics,
        "limitations": [
            "Educational prototype trained and evaluated only on synthetic data.",
            "Metrics measure recovery of the synthetic labeling rules, not clinical validity or patient outcomes.",
            "Not for diagnosis, screening, triage, treatment, or clinical decision-making.",
        ],
    }
    METADATA.write_text(json.dumps(metadata, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({"artifact": str(ARTIFACT), "metadata": str(METADATA), "metrics": metrics}, indent=2))
    return metadata


if __name__ == "__main__":
    train()
