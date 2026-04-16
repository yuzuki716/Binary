from fastapi import APIRouter
from app.services.data_fetcher import get_symbols, SYMBOL_MAP, fetch_ohlcv
from app.models.schemas import SymbolsResponse

router = APIRouter(prefix="/symbols", tags=["symbols"])


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
