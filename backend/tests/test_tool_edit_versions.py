"""Tool edits must snapshot to artifact_versions at turn end.

Without this, clicking "latest version" in the History dropdown reverts to
a stale state from the last whole-file emission — any tool edits in between
are silently absent from history.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.artifact import Artifact, ArtifactVersion
from app.models.chat import Chat, Message
from app.models.user import User
from app.routers.chats import _save_and_emit_artifacts

pytestmark = pytest.mark.asyncio


async def test_tool_edits_create_new_artifact_version(db_engine):
    """After a turn with tool edits, a fresh ArtifactVersion row must be
    created matching the current files — so "go back to latest" works."""
    from app.auth.password import hash_password

    session_factory = async_sessionmaker(
        db_engine, class_=AsyncSession, expire_on_commit=False
    )

    # Seed: user + chat + assistant msg + artifact + one initial version row.
    async with session_factory() as s:
        user = User(
            email="tv@test.com",
            password_hash=hash_password("x"),
            name="Tool Version Tester",
            public_id="user-tv000001",
        )
        s.add(user)
        await s.flush()

        chat = Chat(user_id=user.id, title="t")
        s.add(chat)
        await s.flush()

        msg = Message(chat_id=chat.id, role="assistant", content="v1 msg")
        s.add(msg)
        await s.flush()

        art = Artifact(
            message_id=msg.id,
            chat_id=chat.id,
            user_id=user.id,
            title="Demo",
            artifact_type="project",
            template="react",
            # This is the state AFTER tool edits would have applied,
            # simulating what edit_artifact_file mutates on the Artifact row.
            files={"/App.js": "POST_TOOL_EDIT"},
        )
        s.add(art)
        await s.flush()
        s.add(
            ArtifactVersion(
                artifact_id=art.id,
                version_number=1,
                title=art.title,
                files={"/App.js": "PRE_TOOL_EDIT"},
            )
        )
        # A new assistant message representing "this turn".
        this_turn_msg = Message(chat_id=chat.id, role="assistant", content="this turn")
        s.add(this_turn_msg)
        await s.commit()
        await s.refresh(art)
        await s.refresh(chat)
        await s.refresh(this_turn_msg)

        chat_id = chat.id
        user_id = user.id
        art_public_id = art.public_id
        this_turn_msg_id = this_turn_msg.id

    # Invoke the post-turn bookkeeping. Pretend the LLM made 2 tool edits.
    tool_executor = SimpleNamespace(artifact_edit_counter={"count": 2})
    queue: asyncio.Queue = asyncio.Queue()

    async with session_factory() as db:
        # Re-attach rows into this session.
        chat_fresh = (
            await db.execute(select(Chat).where(Chat.id == chat_id))
        ).scalar_one()
        msg_fresh = (
            await db.execute(select(Message).where(Message.id == this_turn_msg_id))
        ).scalar_one()

        await _save_and_emit_artifacts(
            found_artifacts=[],  # no whole-file emission, pure tool-edit turn
            artifact_context={"id": art_public_id},
            chat=chat_fresh,
            user_id=user_id,
            chat_public_id="chat-xyz",
            assistant_msg=msg_fresh,
            queue=queue,
            db=db,
            tool_executor=tool_executor,
        )

    # Verify: a v2 row now exists, its files match post-tool-edit state,
    # and the artifact's message_id points at this turn's message.
    async with session_factory() as db:
        versions = (
            (
                await db.execute(
                    select(ArtifactVersion)
                    .join(Artifact, ArtifactVersion.artifact_id == Artifact.id)
                    .where(Artifact.public_id == art_public_id)
                    .order_by(ArtifactVersion.version_number)
                )
            )
            .scalars()
            .all()
        )

        assert [v.version_number for v in versions] == [1, 2], (
            "tool-edit turn must append a v2 row"
        )
        assert versions[-1].files == {"/App.js": "POST_TOOL_EDIT"}, (
            "latest version must snapshot the post-edit state, not the pre-edit one"
        )

        refreshed = (
            await db.execute(
                select(Artifact).where(Artifact.public_id == art_public_id)
            )
        ).scalar_one()
        assert refreshed.message_id == this_turn_msg_id, (
            "artifact must rebind to the current turn for auto-open gate"
        )


async def test_whole_file_turn_is_unaffected(db_engine):
    """Turns with zero tool edits must NOT create an extra version row —
    the whole-file path already handles versioning via found_artifacts."""
    from app.auth.password import hash_password

    session_factory = async_sessionmaker(
        db_engine, class_=AsyncSession, expire_on_commit=False
    )

    async with session_factory() as s:
        user = User(
            email="wf@test.com",
            password_hash=hash_password("x"),
            name="WF",
            public_id="user-wf000001",
        )
        s.add(user)
        await s.flush()
        chat = Chat(user_id=user.id, title="t")
        s.add(chat)
        await s.flush()
        msg = Message(chat_id=chat.id, role="assistant", content="")
        s.add(msg)
        await s.flush()
        art = Artifact(
            message_id=msg.id,
            chat_id=chat.id,
            user_id=user.id,
            title="D",
            artifact_type="project",
            template="react",
            files={"/a.js": "x"},
        )
        s.add(art)
        await s.flush()
        s.add(
            ArtifactVersion(
                artifact_id=art.id,
                version_number=1,
                title="D",
                files={"/a.js": "x"},
            )
        )
        await s.commit()
        art_public_id = art.public_id
        chat_id = chat.id
        user_id = user.id
        msg_id = msg.id

    # tool_edit_count = 0 → no tool edits happened. Bookkeeping should no-op.
    tool_executor = SimpleNamespace(artifact_edit_counter={"count": 0})

    async with session_factory() as db:
        chat_fresh = (
            await db.execute(select(Chat).where(Chat.id == chat_id))
        ).scalar_one()
        msg_fresh = (
            await db.execute(select(Message).where(Message.id == msg_id))
        ).scalar_one()
        await _save_and_emit_artifacts(
            found_artifacts=[],
            artifact_context={"id": art_public_id},
            chat=chat_fresh,
            user_id=user_id,
            chat_public_id="chat-xyz",
            assistant_msg=msg_fresh,
            queue=asyncio.Queue(),
            db=db,
            tool_executor=tool_executor,
        )

    async with session_factory() as db:
        versions = (
            (
                await db.execute(
                    select(ArtifactVersion)
                    .join(Artifact, ArtifactVersion.artifact_id == Artifact.id)
                    .where(Artifact.public_id == art_public_id)
                )
            )
            .scalars()
            .all()
        )
        assert len(versions) == 1, (
            f"expected no new version row on a zero-tool-edit turn, got {len(versions)}"
        )
