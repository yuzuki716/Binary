from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.models.orm import AutoLatest
from app.services.auto_scheduler import get_scheduler_status

router = APIRouter()


@router.get("/auto/latest")
async def get_auto_latest(db: AsyncSession = Depends(get_db)):
    """Return the latest auto-analysis batch ID and timestamps per category."""
    rows = (await db.execute(select(AutoLatest))).scalars().all()

    categories: dict = {}
    for row in rows:
        categories[row.category] = {
            "batch_id": row.batch_id,
            "created_at": row.created_at,
            "next_run_at": row.next_run_at,
        }

    status = get_scheduler_status()
    return {
        "categories": categories,
        "is_running": status["is_running"],
        "next_run_at": status["next_run_at"],
    }


@router.post("/auto/notify-test")
async def notify_test():
    """Send a test Discord notification to verify webhook configuration."""
    from app.core.config import settings
    import httpx

    webhook_url = settings.discord_webhook_url
    if not webhook_url:
        return {"ok": False, "error": "DISCORD_WEBHOOK_URL が設定されていません"}

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(webhook_url, json={
                "content": "✅ **テスト通知** — Binary Options Simulator から正常に通知を受信できています！"
            })
            resp.raise_for_status()
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}
