import pytest
from sqlalchemy import select

from app.models.chat import Chat, Message


@pytest.mark.anyio
async def test_create_chat(db):
    chat = Chat(title="Test Chat")
    db.add(chat)
    await db.commit()
    await db.refresh(chat)

    assert chat.id is not None
    assert chat.title == "Test Chat"
    assert chat.created_at is not None
    assert chat.updated_at is not None


@pytest.mark.anyio
async def test_create_chat_without_title(db):
    chat = Chat()
    db.add(chat)
    await db.commit()
    await db.refresh(chat)

    assert chat.id is not None
    assert chat.title is None


@pytest.mark.anyio
async def test_create_message(db):
    chat = Chat(title="Test")
    db.add(chat)
    await db.commit()
    await db.refresh(chat)

    msg = Message(chat_id=chat.id, role="user", content="Hello!")
    db.add(msg)
    await db.commit()
    await db.refresh(msg)

    assert msg.id is not None
    assert msg.chat_id == chat.id
    assert msg.role == "user"
    assert msg.content == "Hello!"
    assert msg.created_at is not None


@pytest.mark.anyio
async def test_chat_messages_relationship(db):
    chat = Chat(title="Relationship test")
    db.add(chat)
    await db.commit()
    await db.refresh(chat)

    msg1 = Message(chat_id=chat.id, role="user", content="Hi")
    msg2 = Message(chat_id=chat.id, role="assistant", content="Hello!")
    db.add_all([msg1, msg2])
    await db.commit()

    result = await db.execute(select(Chat).where(Chat.id == chat.id))
    loaded_chat = result.scalar_one()
    await db.refresh(loaded_chat, ["messages"])

    assert len(loaded_chat.messages) == 2
    assert loaded_chat.messages[0].role == "user"
    assert loaded_chat.messages[1].role == "assistant"


@pytest.mark.anyio
async def test_cascade_delete(db):
    chat = Chat(title="Delete test")
    db.add(chat)
    await db.commit()
    await db.refresh(chat)

    msg = Message(chat_id=chat.id, role="user", content="Bye")
    db.add(msg)
    await db.commit()

    await db.delete(chat)
    await db.commit()

    result = await db.execute(select(Message))
    remaining = result.scalars().all()
    assert len(remaining) == 0
