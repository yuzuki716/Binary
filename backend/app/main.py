from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os
import logging

from app.core.config import settings
from app.core.database import init_db
from app.api import symbols, simulations, results, charts, websocket, batch, auto
from app.services.auto_scheduler import start_scheduler, stop_scheduler, get_scheduler_status
from app.services.signal_monitor import start_monitor

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s"
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting Binary Options Simulator API...")
    await init_db()
    logger.info("Database initialized")
    await start_scheduler()
    await start_monitor()
    yield
    stop_scheduler()
    logger.info("Shutting down...")


app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(symbols.router, prefix="/api")
app.include_router(simulations.router, prefix="/api")
app.include_router(results.router, prefix="/api")
app.include_router(charts.router, prefix="/api")
app.include_router(batch.router, prefix="/api")
app.include_router(auto.router, prefix="/api")
app.include_router(websocket.router)


@app.get("/api/health")
async def health():
    status = get_scheduler_status()
    # Watchdog: restart scheduler if APScheduler lost its job (e.g. crashed)
    if status["next_run_at"] is None and not status["is_running"]:
        try:
            stop_scheduler()
            await start_scheduler()
            logger.info("Scheduler restarted by health watchdog")
        except Exception as e:
            logger.warning("Health watchdog failed to restart scheduler: %s", e)
    return {"status": "ok"}


# Serve frontend static files in production
frontend_dist = os.path.join(os.path.dirname(__file__), "../../frontend/dist")
if os.path.isdir(frontend_dist):
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="static")
