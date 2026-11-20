"""WebSocket connection manager for public charger statuses and private user events."""

import asyncio
from collections import defaultdict
from typing import Any

from fastapi import WebSocket


class WebSocketManager:
    """Manages public status subscribers and authenticated per-user channels."""

    def __init__(self) -> None:
        self.public_connections: set[WebSocket] = set()
        self.user_connections: dict[int, set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def connect_public(self, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self.public_connections.add(websocket)

    async def disconnect_public(self, websocket: WebSocket) -> None:
        async with self._lock:
            self.public_connections.discard(websocket)

    async def connect_user(self, user_id: int, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self.user_connections[user_id].add(websocket)

    async def disconnect_user(self, user_id: int, websocket: WebSocket) -> None:
        async with self._lock:
            if user_id in self.user_connections:
                self.user_connections[user_id].discard(websocket)
                if not self.user_connections[user_id]:
                    del self.user_connections[user_id]

    async def broadcast_status(self, payload: dict[str, Any]) -> None:
        """Broadcast non-sensitive charger status change to all public clients."""
        async with self._lock:
            targets = list(self.public_connections)
        dead: list[WebSocket] = []
        for ws in targets:
            try:
                await ws.send_json(payload)
            except Exception:
                dead.append(ws)
        if dead:
            async with self._lock:
                for ws in dead:
                    self.public_connections.discard(ws)

    async def send_to_user(self, user_id: int, payload: dict[str, Any]) -> None:
        """Deliver private booking/notification events strictly to the owning user."""
        async with self._lock:
            targets = list(self.user_connections.get(user_id, ()))
        dead: list[WebSocket] = []
        for ws in targets:
            try:
                await ws.send_json(payload)
            except Exception:
                dead.append(ws)
        if dead:
            async with self._lock:
                for ws in dead:
                    if user_id in self.user_connections:
                        self.user_connections[user_id].discard(ws)


ws_manager = WebSocketManager()
