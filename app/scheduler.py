from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from datetime import datetime, timedelta, timezone
from sqlmodel import Session, select
from .database import engine
from .models import Order
from .storage import delete_file
from .config import settings
import logging

logger = logging.getLogger(__name__)
scheduler = AsyncIOScheduler()

def cleanup_old_orders():
    logger.info("Starting cleanup of old orders...")
    cutoff_date = datetime.now(timezone.utc) - timedelta(days=settings.RETENTION_DAYS)
    
    with Session(engine) as session:
        # Find orders older than retention days
        statement = select(Order).where(Order.created_at < cutoff_date)
        old_orders = session.exec(statement).all()
        
        for order in old_orders:
            try:
                delete_file(order.file_key)
                session.delete(order)
                session.commit()
                logger.info(f"Deleted old order {order.id} and its file.")
            except Exception as e:
                session.rollback()
                logger.error(f"Failed to clean up order {order.id}: {e}")

def start_scheduler():
    # Run daily at 02:00 UTC
    scheduler.add_job(cleanup_old_orders, CronTrigger(hour=2, minute=0, timezone=timezone.utc))
    scheduler.start()
    logger.info("Scheduler started.")

def stop_scheduler():
    try:
        scheduler.shutdown()
        logger.info("Scheduler stopped.")
    except Exception:
        pass
