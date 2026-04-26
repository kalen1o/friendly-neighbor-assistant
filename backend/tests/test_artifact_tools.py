"""Unit tests for the artifact editing tool executor."""

from __future__ import annotations

import asyncio
import json

import pytest
from sqlalchemy import select

from app.agent.artifact_tools import make_artifact_tool_executor
from app.models.artifact import Artifact
from app.models.chat import Chat, Message

pytestmark = pytest.mark.asyncio


async def _seed(db_engine, files):
    """Create a chat + message + artifact owned by user_id=1 with the given files."""
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
    from app.auth.password import hash_password
    from app.models.user import User

    session_factory = async_sessionmaker(
        db_engine, class_=AsyncSession, expire_on_commit=False
    )
    async with session_factory() as s:
        user = User(
            id=1,
            email="tool@test.com",
            password_hash=hash_password("x"),
            name="Tool Tester",
            public_id="user-toolz001",
        )
        s.add(user)
        await s.flush()

        chat = Chat(user_id=user.id, title="Art")
        s.add(chat)
        await s.flush()

        msg = Message(chat_id=chat.id, role="assistant", content="here")
        s.add(msg)
        await s.flush()

        art = Artifact(
            message_id=msg.id,
            chat_id=chat.id,
            user_id=user.id,
            title="T",
            artifact_type="project",
            template="react",
            files=files,
        )
        s.add(art)
        await s.commit()
        await s.refresh(art)
        return chat, msg, art, user


async def test_list_returns_file_summary(db_engine):
    chat, msg, art, user = await _seed(
        db_engine, {"/App.js": "x\ny", "/styles.css": "h1 {}"}
    )
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    session_factory = async_sessionmaker(
        db_engine, class_=AsyncSession, expire_on_commit=False
    )
    async with session_factory() as db:
        q: asyncio.Queue = asyncio.Queue()
        h = make_artifact_tool_executor(
            db,
            artifact_public_id=art.public_id,
            chat_id=chat.id,
            user_id=user.id,
            sse_queue=q,
        )
        result = await h("list_artifact_files", {})
    assert "/App.js" in result and "/styles.css" in result
    assert "(empty project)" not in result


async def test_read_returns_full_contents(db_engine):
    chat, msg, art, user = await _seed(db_engine, {"/App.js": "export default 1;"})
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    session_factory = async_sessionmaker(
        db_engine, class_=AsyncSession, expire_on_commit=False
    )
    async with session_factory() as db:
        q: asyncio.Queue = asyncio.Queue()
        h = make_artifact_tool_executor(
            db,
            artifact_public_id=art.public_id,
            chat_id=chat.id,
            user_id=user.id,
            sse_queue=q,
        )
        result = await h("read_artifact_file", {"path": "/App.js"})
    assert result == "export default 1;"


async def test_read_missing_path_lists_available(db_engine):
    chat, msg, art, user = await _seed(db_engine, {"/App.js": "x", "/styles.css": "y"})
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    session_factory = async_sessionmaker(
        db_engine, class_=AsyncSession, expire_on_commit=False
    )
    async with session_factory() as db:
        q: asyncio.Queue = asyncio.Queue()
        h = make_artifact_tool_executor(
            db,
            artifact_public_id=art.public_id,
            chat_id=chat.id,
            user_id=user.id,
            sse_queue=q,
        )
        result = await h("read_artifact_file", {"path": "/nope.js"})
    assert "not found" in result
    assert "/App.js" in result and "/styles.css" in result


async def test_edit_applies_change_and_emits_sse(db_engine):
    chat, msg, art, user = await _seed(
        db_engine,
        {"/styles.css": "body { background: #000; color: white; }"},
    )
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    session_factory = async_sessionmaker(
        db_engine, class_=AsyncSession, expire_on_commit=False
    )
    async with session_factory() as db:
        q: asyncio.Queue = asyncio.Queue()
        h = make_artifact_tool_executor(
            db,
            artifact_public_id=art.public_id,
            chat_id=chat.id,
            user_id=user.id,
            sse_queue=q,
        )
        result = await h(
            "edit_artifact_file",
            {
                "path": "/styles.css",
                "old_string": "background: #000",
                "new_string": "background: #fff",
            },
        )

        r = await db.execute(select(Artifact).where(Artifact.id == art.id))
        updated = r.scalar_one()

    assert "Edited /styles.css" in result
    assert updated.files["/styles.css"] == "body { background: #fff; color: white; }"

    event = q.get_nowait()
    assert event["event"] == "artifact_tool_edit"
    payload = json.loads(event["data"])
    assert payload["path"] == "/styles.css"
    assert "background: #fff" in payload["code"]
    assert h.edit_counter["count"] == 1


async def test_edit_non_unique_old_string_rejects(db_engine):
    """Appears twice → must fail rather than pick one at random."""
    chat, msg, art, user = await _seed(
        db_engine,
        {"/x.js": "const a = 1;\nconst b = 1;\n"},
    )
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    session_factory = async_sessionmaker(
        db_engine, class_=AsyncSession, expire_on_commit=False
    )
    async with session_factory() as db:
        q: asyncio.Queue = asyncio.Queue()
        h = make_artifact_tool_executor(
            db,
            artifact_public_id=art.public_id,
            chat_id=chat.id,
            user_id=user.id,
            sse_queue=q,
        )
        result = await h(
            "edit_artifact_file",
            {"path": "/x.js", "old_string": "= 1;", "new_string": "= 2;"},
        )
    assert "appears 2 times" in result
    assert h.edit_counter["count"] == 0
    assert q.empty()


async def test_edit_missing_old_string_rejects(db_engine):
    chat, msg, art, user = await _seed(db_engine, {"/x.js": "const a = 1;"})
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    session_factory = async_sessionmaker(
        db_engine, class_=AsyncSession, expire_on_commit=False
    )
    async with session_factory() as db:
        q: asyncio.Queue = asyncio.Queue()
        h = make_artifact_tool_executor(
            db,
            artifact_public_id=art.public_id,
            chat_id=chat.id,
            user_id=user.id,
            sse_queue=q,
        )
        result = await h(
            "edit_artifact_file",
            {"path": "/x.js", "old_string": "nothing here", "new_string": "y"},
        )
    assert "not found" in result
    assert h.edit_counter["count"] == 0


async def test_edit_creates_new_file_with_empty_old_string(db_engine):
    chat, msg, art, user = await _seed(db_engine, {"/App.js": "x"})
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    session_factory = async_sessionmaker(
        db_engine, class_=AsyncSession, expire_on_commit=False
    )
    async with session_factory() as db:
        q: asyncio.Queue = asyncio.Queue()
        h = make_artifact_tool_executor(
            db,
            artifact_public_id=art.public_id,
            chat_id=chat.id,
            user_id=user.id,
            sse_queue=q,
        )
        result = await h(
            "edit_artifact_file",
            {"path": "/new.css", "old_string": "", "new_string": "body { margin: 0; }"},
        )
        r = await db.execute(select(Artifact).where(Artifact.id == art.id))
        updated = r.scalar_one()

    assert "Edited /new.css" in result
    assert updated.files["/new.css"] == "body { margin: 0; }"
    assert updated.files["/App.js"] == "x"  # untouched
