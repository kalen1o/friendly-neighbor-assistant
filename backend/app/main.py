from contextlib import asynccontextmanager

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.db.engine import dispose_engine, init_engine


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    init_engine(settings)
    yield
    await dispose_engine()


app = FastAPI(title="Friendly Neighbor", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health_check():
    return {"status": "ok"}


@app.get("/api/llm/test")
async def test_llm(message: str = Query(description="Message to send to the LLM")):
    """Temporary endpoint to test LLM provider. Remove in Phase 2."""
    from app.llm.provider import get_llm_response

    settings = get_settings()
    messages = [{"role": "user", "content": message}]
    response = await get_llm_response(messages, settings)
    return {"provider": settings.ai_provider, "response": response}
