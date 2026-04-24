"""Event-driven core: bus, events, workers.

Decouples message ingress (HTTP, webhooks) from agent execution so new
ingress channels can be added without reimplementing the invocation path.
"""
from app.core.events import Event, InboundEvent, OutboundEvent, InboundSource
from app.core.eventbus import EventBus, get_eventbus, set_eventbus
from app.core.worker import Worker, SubscriberWorker

__all__ = [
    "Event",
    "InboundEvent",
    "OutboundEvent",
    "InboundSource",
    "EventBus",
    "Worker",
    "SubscriberWorker",
    "get_eventbus",
    "set_eventbus",
]
