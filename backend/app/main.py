"""FastAPI application entry point for ChargeKaro."""

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from sqlalchemy import select

from app.api import ai, auth, bookings, owner_admin, stations, ws
from app.core.config import get_settings
from app.core.database import Base, SessionLocal, engine
from app.models.station import Station
from app.security.deps import limiter
from app.security.middleware import SecurityHeadersMiddleware
from app.services.simulator import simulator_loop

logger = logging.getLogger("chargekaro")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Initialize DB schema, auto-seed demo data if empty, and start simulator."""
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        has_station = db.scalar(select(Station.id).limit(1))
    if not has_station:
        from seed import seed_database
        seed_database(reset=False)

    sim_task = asyncio.create_task(simulator_loop())
    try:
        yield
    finally:
        sim_task.cancel()
        try:
            await sim_task
        except asyncio.CancelledError:
            pass


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="ChargeKaro API",
        version="1.0.0",
        description="AI-powered EV charging station discovery, live telemetry, and booking platform for Delhi-NCR (Demo Mode).",
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )

    app.state.limiter = limiter
    app.add_middleware(SlowAPIMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)
    import os
    origins = list(settings.cors_origins_list)
    app_url = os.environ.get("APP_URL", "").strip().rstrip("/")
    if app_url and app_url not in origins:
        origins.append(app_url)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_origin_regex=r"^https://([a-zA-Z0-9-]+\.)*(run\.app|googleusercontent\.com)$",
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-CSRF-Token", "Idempotency-Key", "X-Correlation-ID"],
    )

    @app.exception_handler(RateLimitExceeded)
    async def rate_limit_handler(request: Request, _exc: RateLimitExceeded):
        corr = getattr(request.state, "correlation_id", "unknown")
        return JSONResponse(
            status_code=429,
            content={"detail": "Rate limit exceeded. Please wait briefly and try again.", "correlation_id": corr},
        )

    @app.exception_handler(RequestValidationError)
    async def validation_handler(request: Request, exc: RequestValidationError):
        corr = getattr(request.state, "correlation_id", "unknown")
        first_err = exc.errors()[0] if exc.errors() else {}
        field = ".".join(str(x) for x in first_err.get("loc", [])[1:])
        msg = first_err.get("msg", "Invalid input")
        return JSONResponse(
            status_code=422,
            content={"detail": f"Validation error{f' on {field}' if field else ''}: {msg}", "correlation_id": corr},
        )

    @app.exception_handler(HTTPException)
    async def http_exception_handler(request: Request, exc: HTTPException):
        corr = getattr(request.state, "correlation_id", "unknown")
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.detail, "correlation_id": corr},
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception):
        corr = getattr(request.state, "correlation_id", "unknown")
        logger.exception("Unhandled error [%s]: %s", corr, exc)
        return JSONResponse(
            status_code=500,
            content={"detail": "An unexpected internal error occurred.", "correlation_id": corr},
        )

    prefix = settings.api_v1_prefix
    app.include_router(auth.router, prefix=prefix)
    app.include_router(stations.router, prefix=prefix)
    app.include_router(bookings.router, prefix=prefix)
    app.include_router(ai.router, prefix=prefix)
    app.include_router(owner_admin.router, prefix=prefix)
    app.include_router(ws.router)

    @app.get("/api/health")
    def health_check():
        return {"status": "ok", "service": "chargekaro-api", "mode": "demo"}

    return app


app = create_app()
