"""WebSocket endpoints for public charger status stream and private user events."""

import jwt
from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect, status

from app.security.tokens import decode_access_token
from app.services.websocket_manager import ws_manager

router = APIRouter(tags=["websockets"])


@router.websocket("/ws/status")
async def ws_public_status(websocket: WebSocket):
    """Public live stream broadcasting ONLY non-sensitive charger status changes."""
    await ws_manager.connect_public(websocket)
    try:
        await websocket.send_json({"type": "connected", "channel": "public_status"})
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await ws_manager.disconnect_public(websocket)
    except Exception:
        await ws_manager.disconnect_public(websocket)


@router.websocket("/ws/me")
async def ws_private_user(websocket: WebSocket, token: str | None = Query(default=None)):
    """Authenticated WebSocket channel delivering private booking & alert events."""
    raw_token = token or websocket.cookies.get("ck_access")
    if not raw_token:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    try:
        payload = decode_access_token(raw_token)
        user_id = int(payload["sub"])
    except (jwt.PyJWTError, ValueError, KeyError):
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await ws_manager.connect_user(user_id, websocket)
    try:
        await websocket.send_json({"type": "connected", "channel": "private_user", "user_id": user_id})
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await ws_manager.disconnect_user(user_id, websocket)
    except Exception:
        await ws_manager.disconnect_user(user_id, websocket)
