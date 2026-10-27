import hmac
import json
import os
from pathlib import Path
from typing import Annotated, Literal

import joblib
import pandas as pd
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, Field
from starlette.types import ASGIApp, Message, Receive, Scope, Send

load_dotenv(Path(__file__).parents[2] / ".env")

MODEL_DIR = Path(os.getenv("MODEL_DIR", Path(__file__).parent / "artifacts"))
MODEL_PATH = Path(os.getenv("MODEL_PATH", MODEL_DIR / "medlab-synthetic-cbc-v1.joblib"))
METADATA_PATH = Path(os.getenv("MODEL_METADATA_PATH", MODEL_PATH.with_suffix(".json")))
SERVICE_TOKEN = os.getenv("ML_SERVICE_TOKEN", "")
MAX_REQUEST_BYTES = 64 * 1024
EXPECTED_FEATURES = (
    "age_years",
    "sex",
    "hemoglobin_g_dl",
    "mcv_fl",
    "wbc_10e9_l",
    "platelets_10e9_l",
)

if len(SERVICE_TOKEN) < 32:
    raise RuntimeError("ML_SERVICE_TOKEN must be configured with at least 32 characters")
if not MODEL_PATH.is_file() or not METADATA_PATH.is_file():
    raise RuntimeError("Trained ML artifact and metadata are required; run python train.py")

model = joblib.load(MODEL_PATH)
metadata = json.loads(METADATA_PATH.read_text(encoding="utf-8"))
if metadata.get("model_version") != "medlab-synthetic-cbc-v1":
    raise RuntimeError("Loaded model metadata has an unexpected model version")
if set(metadata.get("classes", [])) != set(model.named_steps["classifier"].classes_):
    raise RuntimeError("Model classes do not match model metadata")

app = FastAPI(
    title="MedLab Educational ML Service",
    version=metadata["model_version"],
    description="Synthetic-data-only educational prototype. Not for clinical decision-making.",
    docs_url=None,
    redoc_url=None,
)
bearer = HTTPBearer(auto_error=False)


class CbcFeatures(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    age_years: Annotated[int, Field(ge=0, le=120)]
    sex: Literal["MALE", "FEMALE", "OTHER", "UNKNOWN"]
    hemoglobin_g_dl: Annotated[float, Field(ge=0, le=30, allow_inf_nan=False)]
    mcv_fl: Annotated[float, Field(ge=0, le=200, allow_inf_nan=False)]
    wbc_10e9_l: Annotated[float, Field(ge=0, le=500, allow_inf_nan=False)]
    platelets_10e9_l: Annotated[float, Field(ge=0, le=5000, allow_inf_nan=False)]


class PredictionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    features: CbcFeatures


class BodyLimitMiddleware:
    def __init__(self, app: ASGIApp, max_bytes: int):
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        length = next(
            (value for name, value in scope.get("headers", []) if name.lower() == b"content-length"),
            None,
        )
        if length is not None:
            try:
                declared_length = int(length)
            except ValueError:
                response = JSONResponse(
                    status_code=400,
                    content={"error": {"code": "INVALID_CONTENT_LENGTH", "message": "Invalid content length"}},
                )
                await response(scope, receive, send)
                return
            if declared_length < 0:
                response = JSONResponse(
                    status_code=400,
                    content={"error": {"code": "INVALID_CONTENT_LENGTH", "message": "Invalid content length"}},
                )
                await response(scope, receive, send)
                return
            if declared_length > self.max_bytes:
                await self._too_large(scope, receive, send)
                return
        body = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            if message["type"] == "http.request":
                body.extend(message.get("body", b""))
                if len(body) > self.max_bytes:
                    await self._too_large(scope, receive, send)
                    return
                if not message.get("more_body", False):
                    break

        body_sent = False

        async def replay_body() -> Message:
            nonlocal body_sent
            if body_sent:
                return {"type": "http.disconnect"}
            body_sent = True
            return {"type": "http.request", "body": bytes(body), "more_body": False}

        await self.app(scope, replay_body, send)

    async def _too_large(self, scope: Scope, receive: Receive, send: Send) -> None:
        response = JSONResponse(
            status_code=413,
            content={"error": {"code": "REQUEST_TOO_LARGE", "message": "Request body exceeds 64 KiB"}},
        )
        await response(scope, receive, send)


app.add_middleware(BodyLimitMiddleware, max_bytes=MAX_REQUEST_BYTES)


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    details = [
        {"field": ".".join(str(part) for part in error["loc"] if part not in ("body",)), "message": error["msg"]}
        for error in exc.errors()
    ]
    return JSONResponse(
        status_code=422,
        content={"error": {"code": "INVALID_REQUEST", "message": "Request validation failed", "details": details}},
    )


async def require_service_token(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> None:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=401,
            detail={"code": "UNAUTHORIZED", "message": "Valid service credentials are required"},
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not hmac.compare_digest(credentials.credentials.encode(), SERVICE_TOKEN.encode()):
        raise HTTPException(
            status_code=401,
            detail={"code": "UNAUTHORIZED", "message": "Valid service credentials are required"},
            headers={"WWW-Authenticate": "Bearer"},
        )


@app.exception_handler(HTTPException)
async def http_error(_: Request, exc: HTTPException) -> JSONResponse:
    detail = exc.detail if isinstance(exc.detail, dict) else {"code": "HTTP_ERROR", "message": str(exc.detail)}
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": detail},
        headers=exc.headers,
    )


@app.exception_handler(404)
async def not_found(_: Request, __: Exception) -> JSONResponse:
    return JSONResponse(status_code=404, content={"error": {"code": "NOT_FOUND", "message": "Endpoint not found"}})


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/model-info")
async def model_info() -> dict[str, object]:
    return {
        "model_version": metadata["model_version"],
        "model_type": metadata["model_type"],
        "dataset": metadata["dataset"],
        "label_rules": metadata["label_rules"],
        "features": metadata["features"],
        "classes": metadata["classes"],
        "metrics": metadata["metrics"],
        "limitations": metadata["limitations"],
    }


@app.post("/predict", dependencies=[Depends(require_service_token)])
async def predict(request: PredictionRequest) -> dict[str, object]:
    values = request.features.model_dump()
    frame = pd.DataFrame([{name: values[name] for name in EXPECTED_FEATURES}])
    predicted = str(model.predict(frame)[0])
    probabilities = model.predict_proba(frame)[0]
    classes = [str(name) for name in model.named_steps["classifier"].classes_]
    return {
        "model_version": metadata["model_version"],
        "predicted_class": predicted,
        "probabilities": {name: float(probability) for name, probability in zip(classes, probabilities, strict=True)},
        "synthetic_data_only": True,
        "clinical_use": False,
    }
