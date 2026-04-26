"""Tests for the admin artifact-edit analytics endpoint.

Proves the Python-side aggregation of `audit_logs.details` JSON matches
what the admin dashboard tile expects — so we don't ship a tile that
silently shows wrong numbers once real production data arrives.
"""

from __future__ import annotations

import json

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.auth.admin import log_audit
from app.auth.jwt import create_access_token
from app.auth.password import hash_password
from app.config import get_settings
from app.db.session import get_db
from app.main import app
from app.models.user import User

pytestmark = pytest.mark.asyncio


@pytest.fixture
async def admin_client(db_engine, test_settings):
    """Authenticated client whose user has role='admin'."""
    session_factory = async_sessionmaker(
        db_engine, class_=AsyncSession, expire_on_commit=False
    )

    async def override_get_db():
        async with session_factory() as session:
            yield session

    def override_get_settings():
        return test_settings

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_settings] = override_get_settings

    async with session_factory() as session:
        user = User(
            email="admin@test.com",
            password_hash=hash_password("Admin1234"),
            name="Admin",
            public_id="user-admin0001",
            role="admin",
        )
        session.add(user)
        await session.commit()

    token = create_access_token("user-admin0001", test_settings)

    transport = ASGITransport(app=app)
    async with AsyncClient(
        transport=transport,
        base_url="http://test",
        cookies={"access_token": token},
    ) as c:
        yield c, session_factory

    app.dependency_overrides.clear()


async def _seed_edit(session_factory, details: dict) -> None:
    async with session_factory() as s:
        await log_audit(
            s,
            action="artifact_edit",
            resource_type="artifact",
            resource_id="art-xyz",
            details=details,
        )
        await s.commit()


async def test_returns_zero_when_no_edits(admin_client):
    client, _ = admin_client
    r = await client.get("/api/admin/analytics/artifact-edits?days=7")
    assert r.status_code == 200
    body = r.json()
    assert body["total_edits"] == 0
    assert body["tool_adoption_pct"] == 0.0
    assert body["by_path"] == []


async def test_aggregates_tool_and_whole_file_rows(admin_client):
    client, session_factory = admin_client
    # 3 tool edits, 1 whole-file edit
    await _seed_edit(
        session_factory,
        {
            "edit_path": "tool",
            "files_changed": 1,
            "bytes_emitted": 0,
        },
    )
    await _seed_edit(
        session_factory,
        {
            "edit_path": "tool",
            "files_changed": 2,
            "bytes_emitted": 0,
        },
    )
    await _seed_edit(
        session_factory,
        {
            "edit_path": "tool",
            "files_changed": 1,
            "bytes_emitted": 0,
        },
    )
    await _seed_edit(
        session_factory,
        {
            "edit_path": "whole_file_emission",
            "files_emitted": 3,
            "files_changed": 3,
            "bytes_emitted": 9000,
            "bytes_changed": 9000,
            "files_identical": 0,
        },
    )

    r = await client.get("/api/admin/analytics/artifact-edits?days=7")
    assert r.status_code == 200
    body = r.json()
    assert body["total_edits"] == 4
    assert body["tool_adoption_pct"] == 75.0  # 3/4

    # Normalize order — sorted by edit count desc
    by_path = {row["path"]: row for row in body["by_path"]}
    assert set(by_path) == {"tool", "whole_file_emission"}

    assert by_path["tool"]["edits"] == 3
    assert by_path["tool"]["avg_files_changed"] == pytest.approx(4 / 3)
    assert by_path["tool"]["avg_bytes_emitted"] == 0.0

    assert by_path["whole_file_emission"]["edits"] == 1
    assert by_path["whole_file_emission"]["avg_bytes_emitted"] == 9000.0
    assert by_path["whole_file_emission"]["total_bytes_emitted"] == 9000


async def test_ignores_non_artifact_edit_audit_rows(admin_client):
    client, session_factory = admin_client

    # Seed a relevant row…
    await _seed_edit(session_factory, {"edit_path": "tool", "files_changed": 1})
    # …and an unrelated audit row we must NOT count.
    async with session_factory() as s:
        await log_audit(
            s,
            action="send_message",
            resource_type="chat",
            resource_id="chat-abc",
        )
        await s.commit()

    r = await client.get("/api/admin/analytics/artifact-edits?days=7")
    assert r.status_code == 200
    body = r.json()
    assert body["total_edits"] == 1
    assert body["by_path"][0]["path"] == "tool"


async def test_malformed_details_json_is_skipped_not_crashed(admin_client):
    """A corrupt row shouldn't 500 the whole endpoint."""
    client, session_factory = admin_client

    await _seed_edit(session_factory, {"edit_path": "tool", "files_changed": 1})

    # Insert a row with non-JSON details directly so we can be sure of the shape.
    async with session_factory() as s:
        from app.models.audit_log import AuditLog

        s.add(
            AuditLog(
                action="artifact_edit",
                resource_type="artifact",
                resource_id="art-broken",
                details="{not valid json",
            )
        )
        await s.commit()

    r = await client.get("/api/admin/analytics/artifact-edits?days=7")
    assert r.status_code == 200
    body = r.json()
    assert body["total_edits"] == 1  # only the well-formed row


async def test_non_admin_is_rejected(client):
    r = await client.get("/api/admin/analytics/artifact-edits?days=7")
    # Default `client` fixture creates a user with role='user' → 403.
    assert r.status_code == 403


async def test_details_round_trip_via_log_audit_helper(admin_client):
    """Ensures our aggregation still works if details is passed through the real
    log_audit helper (which json.dumps()'s it) rather than inserted raw."""
    client, session_factory = admin_client
    async with session_factory() as s:
        await log_audit(
            s,
            action="artifact_edit",
            resource_type="artifact",
            resource_id="art-1",
            details={"edit_path": "tool", "files_changed": 2, "bytes_emitted": 0},
        )
        await s.commit()

    r = await client.get("/api/admin/analytics/artifact-edits?days=7")
    body = r.json()
    assert body["total_edits"] == 1
    # Round-trip: endpoint parsed the stored JSON and found the right bucket.
    tool = next(p for p in body["by_path"] if p["path"] == "tool")
    assert tool["edits"] == 1
    assert tool["avg_files_changed"] == 2.0


async def test_days_parameter_is_respected(admin_client):
    """Old rows outside the window must not be counted."""
    from datetime import datetime, timedelta, timezone
    from app.models.audit_log import AuditLog

    client, session_factory = admin_client

    # Recent row — in window
    await _seed_edit(session_factory, {"edit_path": "tool", "files_changed": 1})

    # Old row — 30 days ago, outside a 7-day window
    async with session_factory() as s:
        old = AuditLog(
            action="artifact_edit",
            resource_type="artifact",
            resource_id="art-old",
            details=json.dumps({"edit_path": "tool", "files_changed": 5}),
            created_at=datetime.now(timezone.utc) - timedelta(days=30),
        )
        s.add(old)
        await s.commit()

    r = await client.get("/api/admin/analytics/artifact-edits?days=7")
    assert r.json()["total_edits"] == 1

    r = await client.get("/api/admin/analytics/artifact-edits?days=60")
    assert r.json()["total_edits"] == 2
