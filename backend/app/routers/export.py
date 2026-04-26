import io
import logging
from datetime import datetime

from app.utils.time import utcnow_naive

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.dependencies import get_current_user
from app.db.session import get_db
from app.models.chat import Chat
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter(tags=["export"])


async def _get_chat_with_messages(chat_id: str, user: User, db: AsyncSession) -> Chat:
    result = await db.execute(
        select(Chat)
        .where(Chat.public_id == chat_id, Chat.user_id == user.id)
        .options(selectinload(Chat.messages))
    )
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    return chat


def _format_timestamp(dt: datetime) -> str:
    if dt is None:
        return ""
    return dt.strftime("%Y-%m-%d %H:%M")


def _build_markdown(chat: Chat) -> str:
    title = chat.title or "Untitled Conversation"
    lines = [f"# {title}\n"]
    if chat.created_at:
        lines.append(f"*Exported on {_format_timestamp(utcnow_naive())}*\n")
    lines.append("---\n")

    for msg in chat.messages:
        role_label = "You" if msg.role == "user" else "Assistant"
        timestamp = _format_timestamp(msg.created_at) if msg.created_at else ""
        lines.append(f"### {role_label}")
        if timestamp:
            lines.append(f"*{timestamp}*\n")
        lines.append(f"{msg.content}\n")
        lines.append("")

    return "\n".join(lines)


def _build_pdf(chat: Chat) -> bytes:
    from fpdf import FPDF

    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=20)
    pdf.add_page()

    # Title
    title = chat.title or "Untitled Conversation"
    pdf.set_font("Helvetica", "B", 16)
    pdf.cell(0, 10, title, new_x="LMARGIN", new_y="NEXT")

    # Export date
    pdf.set_font("Helvetica", "I", 9)
    pdf.set_text_color(128, 128, 128)
    pdf.cell(
        0,
        6,
        f"Exported on {_format_timestamp(utcnow_naive())}",
        new_x="LMARGIN",
        new_y="NEXT",
    )
    pdf.set_text_color(0, 0, 0)
    pdf.ln(4)

    # Separator
    pdf.set_draw_color(200, 200, 200)
    pdf.line(10, pdf.get_y(), 200, pdf.get_y())
    pdf.ln(6)

    for msg in chat.messages:
        role_label = "You" if msg.role == "user" else "Assistant"
        timestamp = _format_timestamp(msg.created_at) if msg.created_at else ""

        # Role header
        pdf.set_font("Helvetica", "B", 11)
        header = f"{role_label}  {timestamp}" if timestamp else role_label
        pdf.cell(0, 7, header, new_x="LMARGIN", new_y="NEXT")
        pdf.ln(1)

        # Message content
        pdf.set_font("Helvetica", "", 10)
        # Encode to latin-1 safe characters (fpdf limitation with default fonts)
        safe_content = msg.content.encode("latin-1", "replace").decode("latin-1")
        pdf.multi_cell(0, 5, safe_content)
        pdf.ln(4)

    return pdf.output()


@router.get("/api/chats/{chat_id}/export")
async def export_chat(
    chat_id: str,
    format: str = Query(default="markdown", pattern="^(markdown|pdf)$"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    chat = await _get_chat_with_messages(chat_id, user, db)

    if format == "pdf":
        pdf_bytes = _build_pdf(chat)
        filename = f"{chat.title or 'conversation'}.pdf"
        return StreamingResponse(
            io.BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    else:
        md_content = _build_markdown(chat)
        filename = f"{chat.title or 'conversation'}.md"
        return StreamingResponse(
            io.BytesIO(md_content.encode("utf-8")),
            media_type="text/markdown; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
