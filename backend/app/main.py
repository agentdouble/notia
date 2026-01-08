from __future__ import annotations

from contextlib import asynccontextmanager
import os

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .supabase import Supabase


class NoteCreate(BaseModel):
    title: str | None = None
    content: str | None = None


class NoteUpdate(BaseModel):
    title: str | None = None
    content: str | None = None


def _get_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing environment variable: {name}")
    return value


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.http = httpx.AsyncClient(timeout=httpx.Timeout(10.0))
    app.state.supabase = Supabase(
        url=_get_env("SUPABASE_URL").rstrip("/"),
        service_role_key=_get_env("SUPABASE_SERVICE_ROLE_KEY"),
        http=app.state.http,
    )
    yield
    await app.state.http.aclose()


app = FastAPI(title="agentdouble-backend", version="0.0.1", lifespan=lifespan)

cors_origins = [o.strip() for o in os.getenv("CORS_ALLOW_ORIGINS", "").split(",") if o.strip()]
if not cors_origins:
    cors_origins = [
        "http://localhost:8081",
        "http://localhost:19006",
        "http://localhost:19000",
        "http://localhost:8000",
    ]

allow_all = len(cors_origins) == 1 and cors_origins[0] == "*"
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if allow_all else cors_origins,
    allow_credentials=False if allow_all else True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_supabase(request: Request) -> Supabase:
    return request.app.state.supabase


async def get_user_id(
    authorization: str = Header(..., alias="Authorization"),
    supabase: Supabase = Depends(get_supabase),
) -> str:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token.")
    access_token = authorization.split(" ", 1)[1].strip()
    if not access_token:
        raise HTTPException(status_code=401, detail="Missing Bearer token.")

    try:
        return await supabase.get_user_id_from_access_token(access_token)
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid access token.")


@app.get("/health")
async def health():
    return {"ok": True}


@app.get("/notes")
async def list_notes(user_id: str = Depends(get_user_id), supabase: Supabase = Depends(get_supabase)):
    try:
        return await supabase.list_notes(user_id)
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=exc.response.status_code, detail=exc.response.text)
    except httpx.RequestError:
        raise HTTPException(status_code=502, detail="Supabase request failed.")


@app.post("/notes")
async def create_note(body: NoteCreate, user_id: str = Depends(get_user_id), supabase: Supabase = Depends(get_supabase)):
    title = (body.title or "").strip() or "Sans titre"
    content = body.content or ""
    try:
        return await supabase.create_note(user_id, title=title, content=content)
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=exc.response.status_code, detail=exc.response.text)
    except httpx.RequestError:
        raise HTTPException(status_code=502, detail="Supabase request failed.")


@app.patch("/notes/{note_id}")
async def update_note(
    note_id: str,
    body: NoteUpdate,
    user_id: str = Depends(get_user_id),
    supabase: Supabase = Depends(get_supabase),
):
    if body.title is None and body.content is None:
        raise HTTPException(status_code=400, detail="Nothing to update.")
    try:
        return await supabase.update_note(user_id, note_id=note_id, title=body.title, content=body.content)
    except ValueError:
        raise HTTPException(status_code=404, detail="Note not found.")
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=exc.response.status_code, detail=exc.response.text)
    except httpx.RequestError:
        raise HTTPException(status_code=502, detail="Supabase request failed.")


@app.delete("/notes/{note_id}")
async def delete_note(note_id: str, user_id: str = Depends(get_user_id), supabase: Supabase = Depends(get_supabase)):
    try:
        await supabase.delete_note(user_id, note_id=note_id)
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=exc.response.status_code, detail=exc.response.text)
    except httpx.RequestError:
        raise HTTPException(status_code=502, detail="Supabase request failed.")
    return {"ok": True}
