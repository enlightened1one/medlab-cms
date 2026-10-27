import csv
import random
from pathlib import Path

SEED = 20261027
ROWS_PER_PATTERN = 1_000
SEXES = ("MALE", "FEMALE", "OTHER", "UNKNOWN")
CLASSES = (
    "within_synthetic_reference",
    "synthetic_anemia_pattern",
    "synthetic_red_cell_index_pattern",
    "synthetic_leukocyte_pattern",
    "synthetic_platelet_pattern",
)
FIELDS = (
    "age_years",
    "sex",
    "hemoglobin_g_dl",
    "mcv_fl",
    "wbc_10e9_l",
    "platelets_10e9_l",
    "label",
)


def classify(row: dict[str, object]) -> str:
    hemoglobin = float(row["hemoglobin_g_dl"])
    sex = str(row["sex"])
    anemia_threshold = {"MALE": 13.0, "FEMALE": 12.0}.get(sex, 12.5)
    if hemoglobin < anemia_threshold:
        return "synthetic_anemia_pattern"
    mcv = float(row["mcv_fl"])
    if mcv < 80 or mcv > 100:
        return "synthetic_red_cell_index_pattern"
    wbc = float(row["wbc_10e9_l"])
    if wbc < 4 or wbc > 11:
        return "synthetic_leukocyte_pattern"
    platelets = float(row["platelets_10e9_l"])
    if platelets < 150 or platelets > 450:
        return "synthetic_platelet_pattern"
    return "within_synthetic_reference"


def generate_rows() -> list[dict[str, object]]:
    rng = random.Random(SEED)
    rows: list[dict[str, object]] = []
    for expected_class in CLASSES:
        for _ in range(ROWS_PER_PATTERN):
            sex = rng.choice(SEXES)
            row: dict[str, object] = {
                "age_years": rng.randint(1, 100),
                "sex": sex,
                "hemoglobin_g_dl": round(rng.uniform(13.5, 16.5), 2),
                "mcv_fl": round(rng.uniform(84, 96), 2),
                "wbc_10e9_l": round(rng.uniform(5, 9), 2),
                "platelets_10e9_l": round(rng.uniform(180, 360), 2),
            }
            if expected_class == "synthetic_anemia_pattern":
                row["hemoglobin_g_dl"] = round(rng.uniform(8.5, 11.5), 2)
            elif expected_class == "synthetic_red_cell_index_pattern":
                row["mcv_fl"] = round(rng.choice((rng.uniform(65, 77), rng.uniform(103, 118))), 2)
            elif expected_class == "synthetic_leukocyte_pattern":
                row["wbc_10e9_l"] = round(rng.choice((rng.uniform(1.5, 3.5), rng.uniform(12.5, 20))), 2)
            elif expected_class == "synthetic_platelet_pattern":
                row["platelets_10e9_l"] = round(rng.choice((rng.uniform(70, 140), rng.uniform(470, 850))), 2)
            row["label"] = classify(row)
            if row["label"] != expected_class:
                raise ValueError(f"Synthetic generator produced an unexpected class: {row['label']}")
            rows.append(row)
    rng.shuffle(rows)
    return rows


def write_dataset(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(generate_rows())


if __name__ == "__main__":
    destination = Path(__file__).parent / "data" / "synthetic_cbc_v1.csv"
    write_dataset(destination)
    print(f"Wrote {len(CLASSES) * ROWS_PER_PATTERN} deterministic synthetic rows to {destination}")
