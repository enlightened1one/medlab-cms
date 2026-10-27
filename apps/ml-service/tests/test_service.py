import json

from fastapi.testclient import TestClient

from generate_synthetic_dataset import CLASSES, generate_rows
from main import app, metadata

client = TestClient(app)
TOKEN = "test-token-only-not-a-real-secret-123456"
FEATURES = {
    "age_years": 45,
    "sex": "FEMALE",
    "hemoglobin_g_dl": 14.2,
    "mcv_fl": 90.0,
    "wbc_10e9_l": 7.2,
    "platelets_10e9_l": 280.0,
}


def test_synthetic_dataset_is_deterministic_and_labels_are_rule_derived() -> None:
    first = generate_rows()
    second = generate_rows()
    assert first == second
    assert len(first) == 5_000
    assert {row["label"] for row in first} == set(CLASSES)


def test_health_and_public_model_info() -> None:
    assert client.get("/health").json() == {"status": "ok"}
    info = client.get("/model-info")
    assert info.status_code == 200
    assert info.json()["dataset"]["synthetic"] is True
    assert info.json()["classes"] == metadata["classes"]


def test_prediction_requires_service_token() -> None:
    response = client.post("/predict", json={"features": FEATURES})
    assert response.status_code == 401


def test_prediction_validates_schema_and_returns_only_trained_classes() -> None:
    response = client.post(
        "/predict",
        headers={"Authorization": f"Bearer {TOKEN}"},
        json={"features": {**FEATURES, "unexpected": True}},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_REQUEST"

    response = client.post(
        "/predict",
        headers={"Authorization": f"Bearer {TOKEN}"},
        json={"features": FEATURES},
    )
    assert response.status_code == 200
    output = response.json()
    assert output["predicted_class"] in metadata["classes"]
    assert set(output["probabilities"]) == set(metadata["classes"])
    assert abs(sum(output["probabilities"].values()) - 1) < 1e-8
    assert output["synthetic_data_only"] is True
    assert output["clinical_use"] is False


def test_oversized_body_is_rejected() -> None:
    response = client.post(
        "/predict",
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json",
            "Content-Length": str(65 * 1024),
        },
        content=json.dumps({"features": FEATURES}).encode(),
    )
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "REQUEST_TOO_LARGE"


def test_chunked_oversized_body_is_rejected() -> None:
    response = client.post(
        "/predict",
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
        content=iter([b"x" * (65 * 1024)]),
    )
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "REQUEST_TOO_LARGE"
