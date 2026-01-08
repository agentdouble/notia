from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import httpx


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass(frozen=True)
class Supabase:
    url: str
    service_role_key: str
    http: httpx.AsyncClient

    def _headers(self) -> dict[str, str]:
        return {
            "apikey": self.service_role_key,
            "Authorization": f"Bearer {self.service_role_key}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        }

    async def get_user_id_from_access_token(self, access_token: str) -> str:
        res = await self.http.get(
            f"{self.url}/auth/v1/user",
            headers={
                "apikey": self.service_role_key,
                "Authorization": f"Bearer {access_token}",
            },
        )
        if res.status_code != 200:
            raise ValueError("invalid_token")

        data: dict[str, Any] = res.json()
        user_id = data.get("id")
        if not isinstance(user_id, str) or not user_id:
            raise ValueError("missing_user_id")
        return user_id

    async def list_notes(self, user_id: str) -> list[dict[str, Any]]:
        res = await self.http.get(
            f"{self.url}/rest/v1/notes",
            params={
                "select": "id,title,content,created_at,updated_at",
                "user_id": f"eq.{user_id}",
                "order": "updated_at.desc",
            },
            headers=self._headers(),
        )
        res.raise_for_status()
        return res.json()

    async def create_note(self, user_id: str, title: str, content: str) -> dict[str, Any]:
        now = _utc_now_iso()
        res = await self.http.post(
            f"{self.url}/rest/v1/notes",
            params={"select": "id,title,content,created_at,updated_at"},
            json={
                "user_id": user_id,
                "title": title,
                "content": content,
                "created_at": now,
                "updated_at": now,
            },
            headers={**self._headers(), "Prefer": "return=representation"},
        )
        res.raise_for_status()
        rows = res.json()
        if not rows:
            raise RuntimeError("supabase_returned_empty_note")
        return rows[0]

    async def update_note(
        self, user_id: str, note_id: str, title: str | None = None, content: str | None = None
    ) -> dict[str, Any]:
        patch: dict[str, Any] = {"updated_at": _utc_now_iso()}
        if title is not None:
            patch["title"] = title
        if content is not None:
            patch["content"] = content

        res = await self.http.patch(
            f"{self.url}/rest/v1/notes",
            params={
                "id": f"eq.{note_id}",
                "user_id": f"eq.{user_id}",
                "select": "id,title,content,created_at,updated_at",
            },
            json=patch,
            headers={**self._headers(), "Prefer": "return=representation"},
        )
        if res.status_code == 404:
            raise ValueError("note_not_found")
        res.raise_for_status()
        rows = res.json()
        if not rows:
            raise ValueError("note_not_found")
        return rows[0]

    async def delete_note(self, user_id: str, note_id: str) -> None:
        res = await self.http.delete(
            f"{self.url}/rest/v1/notes",
            params={"id": f"eq.{note_id}", "user_id": f"eq.{user_id}"},
            headers=self._headers(),
        )
        res.raise_for_status()
