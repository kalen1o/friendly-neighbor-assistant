"""User analytics — detailed per-message token and cost breakdown."""

from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.config import Settings, get_settings
from app.db.session import get_db
from app.models.chat import Chat, Message
from app.models.user import User

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


class MessageCost(BaseModel):
    message_id: str
    chat_id: str
    chat_title: Optional[str]
    created_at: str
    tokens_input: int
    tokens_output: int
    tokens_total: int
    cost_input: float
    cost_output: float
    cost_total: float
    latency: Optional[float]


class DailyAggregate(BaseModel):
    date: str
    messages: int
    tokens_total: int
    cost_total: float


class AnalyticsResponse(BaseModel):
    period: str
    summary: dict
    daily: List[DailyAggregate]
    messages: List[MessageCost]


def _calc_cost(
    tokens_input: int, tokens_output: int, settings: Settings
) -> tuple[float, float, float]:
    cost_in = (tokens_input / 1_000_000) * settings.cost_per_million_input
    cost_out = (tokens_output / 1_000_000) * settings.cost_per_million_output
    return round(cost_in, 6), round(cost_out, 6), round(cost_in + cost_out, 6)


@router.get("", response_model=AnalyticsResponse)
async def get_analytics(
    days: int = Query(default=30, ge=1, le=90),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    since = datetime.now(timezone.utc) - timedelta(days=days)

    # Get all assistant messages with tokens for this user in the period
    result = await db.execute(
        select(Message, Chat.public_id, Chat.title)
        .join(Chat, Chat.id == Message.chat_id)
        .where(
            Chat.user_id == user.id,
            Message.role == "assistant",
            Message.tokens_total != None,
            Message.created_at >= since,
        )
        .order_by(Message.created_at.desc())
    )
    rows = result.all()

    # Build per-message breakdown
    messages = []
    total_input = 0
    total_output = 0
    total_cost = 0.0
    daily_map: dict[str, dict] = {}

    for msg, chat_pid, chat_title in rows:
        t_in = msg.tokens_input or 0
        t_out = msg.tokens_output or 0
        cost_in, cost_out, cost = _calc_cost(t_in, t_out, settings)

        total_input += t_in
        total_output += t_out
        total_cost += cost

        # Daily aggregate
        day_str = msg.created_at.strftime("%Y-%m-%d") if msg.created_at else "unknown"
        if day_str not in daily_map:
            daily_map[day_str] = {"messages": 0, "tokens_total": 0, "cost_total": 0.0}
        daily_map[day_str]["messages"] += 1
        daily_map[day_str]["tokens_total"] += t_in + t_out
        daily_map[day_str]["cost_total"] += cost

        messages.append(
            MessageCost(
                message_id=msg.public_id,
                chat_id=chat_pid,
                chat_title=chat_title,
                created_at=msg.created_at.isoformat() if msg.created_at else "",
                tokens_input=t_in,
                tokens_output=t_out,
                tokens_total=t_in + t_out,
                cost_input=cost_in,
                cost_output=cost_out,
                cost_total=cost,
                latency=msg.latency,
            )
        )

    # Build daily list sorted by date
    daily = sorted(
        [
            DailyAggregate(
                date=d,
                messages=v["messages"],
                tokens_total=v["tokens_total"],
                cost_total=round(v["cost_total"], 4),
            )
            for d, v in daily_map.items()
        ],
        key=lambda x: x.date,
    )

    return AnalyticsResponse(
        period=f"Last {days} days",
        summary={
            "total_messages": len(messages),
            "tokens_input": total_input,
            "tokens_output": total_output,
            "tokens_total": total_input + total_output,
            "cost_total": round(total_cost, 4),
            "cost_input": round(
                (total_input / 1_000_000) * settings.cost_per_million_input, 4
            ),
            "cost_output": round(
                (total_output / 1_000_000) * settings.cost_per_million_output, 4
            ),
        },
        daily=daily,
        messages=messages,
    )
