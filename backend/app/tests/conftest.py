"""Pytest fixtures for ChargeKaro booking concurrency and security test suites."""

import os
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# Isolate test database before importing app
_tmp_dir = tempfile.mkdtemp(prefix="chargekaro_test_")
os.environ["DATABASE_URL"] = f"sqlite:///{Path(_tmp_dir) / 'test.db'}"
os.environ["ENABLE_SIMULATOR"] = "false"
os.environ["ENVIRONMENT"] = "test"

from app.core.config import get_settings

get_settings.cache_clear()

from app.main import create_app  # noqa: E402
from seed import seed_database  # noqa: E402


@pytest.fixture(scope="module")
def client():
    seed_database(reset=True)
    app = create_app()
    with TestClient(app) as tc:
        yield tc
