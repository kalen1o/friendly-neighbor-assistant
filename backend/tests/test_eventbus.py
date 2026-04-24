import asyncio

import pytest

from app.core.eventbus import EventBus
from app.core.events import Event, InboundEvent, OutboundEvent
from app.core.worker import SubscriberWorker


pytestmark = pytest.mark.asyncio


async def _drain(bus: EventBus, ticks: int = 3) -> None:
    """Yield control so the bus loop + dispatched handler tasks can run."""
    for _ in range(ticks):
        await asyncio.sleep(0)


async def test_publish_dispatches_to_subscriber():
    bus = EventBus()
    await bus.start()
    try:
        received: list[InboundEvent] = []

        async def handler(ev: InboundEvent) -> None:
            received.append(ev)

        bus.subscribe(InboundEvent, handler)
        await bus.publish(InboundEvent(source="chat", session_id="abc", content="hi"))
        await _drain(bus)

        assert len(received) == 1
        assert received[0].content == "hi"
        assert received[0].session_id == "abc"
    finally:
        await bus.stop()


async def test_unsubscribe_stops_delivery():
    bus = EventBus()
    await bus.start()
    try:
        received: list[InboundEvent] = []

        async def handler(ev: InboundEvent) -> None:
            received.append(ev)

        bus.subscribe(InboundEvent, handler)
        await bus.publish(InboundEvent(source="chat", session_id="1", content="a"))
        await _drain(bus)

        bus.unsubscribe(handler)
        await bus.publish(InboundEvent(source="chat", session_id="2", content="b"))
        await _drain(bus)

        assert [e.content for e in received] == ["a"]
    finally:
        await bus.stop()


async def test_subscribers_are_isolated_by_event_class():
    bus = EventBus()
    await bus.start()
    try:
        inbound: list[Event] = []
        outbound: list[Event] = []

        async def on_inbound(ev: InboundEvent) -> None:
            inbound.append(ev)

        async def on_outbound(ev: OutboundEvent) -> None:
            outbound.append(ev)

        bus.subscribe(InboundEvent, on_inbound)
        bus.subscribe(OutboundEvent, on_outbound)

        await bus.publish(InboundEvent(source="chat", session_id="x", content="in"))
        await bus.publish(OutboundEvent(source="chat", session_id="x", content="out"))
        await _drain(bus)

        assert len(inbound) == 1 and inbound[0].content == "in"
        assert len(outbound) == 1 and outbound[0].content == "out"
    finally:
        await bus.stop()


async def test_slow_handler_does_not_block_bus():
    """A handler running an LLM turn must not hold up later event dispatch."""
    bus = EventBus()
    await bus.start()
    try:
        order: list[str] = []
        released = asyncio.Event()

        async def slow(ev: InboundEvent) -> None:
            order.append(f"slow-start-{ev.content}")
            await released.wait()
            order.append(f"slow-end-{ev.content}")

        async def fast(ev: OutboundEvent) -> None:
            order.append(f"fast-{ev.content}")

        bus.subscribe(InboundEvent, slow)
        bus.subscribe(OutboundEvent, fast)

        await bus.publish(InboundEvent(source="chat", session_id="1", content="slow"))
        await bus.publish(OutboundEvent(source="chat", session_id="1", content="fast"))
        await _drain(bus, ticks=5)

        # Fast handler ran while slow is still waiting — proves non-blocking dispatch.
        assert order == ["slow-start-slow", "fast-fast"]

        released.set()
        await _drain(bus, ticks=3)
        assert order[-1] == "slow-end-slow"
    finally:
        await bus.stop()


async def test_handler_exception_does_not_kill_bus():
    bus = EventBus()
    await bus.start()
    try:
        received: list[InboundEvent] = []

        async def broken(ev: InboundEvent) -> None:
            raise RuntimeError("boom")

        async def ok(ev: InboundEvent) -> None:
            received.append(ev)

        bus.subscribe(InboundEvent, broken)
        bus.subscribe(InboundEvent, ok)

        await bus.publish(InboundEvent(source="chat", session_id="x", content="hi"))
        await _drain(bus)

        assert len(received) == 1
        # Bus is still alive — publish another event and confirm delivery.
        await bus.publish(InboundEvent(source="chat", session_id="y", content="again"))
        await _drain(bus)
        assert len(received) == 2
    finally:
        await bus.stop()


async def test_subscriber_worker_lifecycle_unsubscribes():
    bus = EventBus()
    await bus.start()
    try:
        received: list[InboundEvent] = []

        class Spy(SubscriberWorker):
            async def start(self) -> None:
                self._subscribe(InboundEvent, self._handle)

            async def _handle(self, ev: InboundEvent) -> None:
                received.append(ev)

        spy = Spy(bus)
        await spy.start()

        await bus.publish(InboundEvent(source="chat", session_id="1", content="a"))
        await _drain(bus)
        assert len(received) == 1

        await spy.stop()
        await bus.publish(InboundEvent(source="chat", session_id="2", content="b"))
        await _drain(bus)
        assert len(received) == 1  # unsubscribed on stop
    finally:
        await bus.stop()
