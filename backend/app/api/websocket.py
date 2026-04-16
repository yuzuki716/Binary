import asyncio
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.workers.simulation_worker import get_progress_queue, remove_progress_queue

router = APIRouter(tags=["websocket"])
logger = logging.getLogger(__name__)


@router.websocket("/ws/progress/{sim_id}")
async def progress_ws(websocket: WebSocket, sim_id: str):
    await websocket.accept()
    queue = get_progress_queue(sim_id)

    if queue is None:
        await websocket.send_text(json.dumps({"type": "error", "message": "シミュレーションが見つかりません"}))
        await websocket.close()
        return

    try:
        while True:
            try:
                msg = await asyncio.wait_for(queue.get(), timeout=30.0)
                await websocket.send_text(json.dumps(msg, ensure_ascii=False))
                if msg.get("type") in ("complete", "error"):
                    break
            except asyncio.TimeoutError:
                # Send ping to keep connection alive
                await websocket.send_text(json.dumps({"type": "ping"}))
    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected for sim {sim_id}")
    except Exception as e:
        logger.warning(f"WebSocket error for sim {sim_id}: {e}")
    finally:
        remove_progress_queue(sim_id)
        try:
            await websocket.close()
        except Exception:
            pass
