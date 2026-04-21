from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.services.data_fetcher import get_symbols, SYMBOL_MAP, fetch_ohlcv
from app.models.schemas import SymbolsResponse
from app.models.orm import SymbolPayoutRate
from app.core.database import AsyncSessionLocal

router = APIRouter(prefix="/symbols", tags=["symbols"])


async def get_db():
    async with AsyncSessionLocal() as db:
        yield db


@router.get("", response_model=SymbolsResponse)
async def list_symbols():
    return get_symbols()


@router.get("/validate")
async def validate_symbol(symbol: str):
    info = SYMBOL_MAP.get(symbol.upper())
    if not info:
        return {"valid": False, "error": f"Unknown symbol: {symbol}"}
    try:
        df = await fetch_ohlcv(symbol.upper(), "1d", 5)
        last_price = float(df["close"].iloc[-1]) if not df.empty else None
        return {"valid": True, "display": info["display"], "last_price": last_price}
    except Exception as e:
        return {"valid": False, "error": str(e)}


@router.get("/payout")
async def get_payout_rates(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(SymbolPayoutRate))).scalars().all()
    return {r.symbol_display: r.payout_pct for r in rows}


@router.put("/payout/{symbol_display:path}")
async def set_payout_rate(symbol_display: str, payout_pct: int, db: AsyncSession = Depends(get_db)):
    existing = await db.get(SymbolPayoutRate, symbol_display)
    if existing:
        existing.payout_pct = payout_pct
    else:
        db.add(SymbolPayoutRate(symbol_display=symbol_display, payout_pct=payout_pct))
    await db.commit()
    return {"ok": True}
