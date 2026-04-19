import httpx
import resend
from .config import settings

resend.api_key = settings.RESEND_API_KEY

async def notify_admin(order_dict: dict, download_url: str):
    message = (
        f"🖨️ New Print Order!\n\n"
        f"Client: {order_dict.get('client_name')}\n"
        f"Email: {order_dict.get('contact_email')}\n"
        f"Specs: {order_dict.get('copies')}x, {order_dict.get('color_mode')}, {order_dict.get('paper_size')}\n"
        f"Download: {download_url}"
    )

    if settings.NOTIFICATION_METHOD == "telegram" and settings.TELEGRAM_BOT_TOKEN:
        url = f"https://api.telegram.org/bot{settings.TELEGRAM_BOT_TOKEN}/sendMessage"
        payload = {
            "chat_id": settings.TELEGRAM_CHAT_ID,
            "text": message
        }
        try:
            async with httpx.AsyncClient() as client:
                await client.post(url, json=payload)
        except Exception as e:
            print(f"Failed to send Telegram notification: {e}")
            
    elif settings.NOTIFICATION_METHOD == "email" and settings.RESEND_API_KEY:
        try:
            params = {
                "from": "Print Portal <onboarding@resend.dev>",
                "to": ["admin@example.com"], # Or whatever you'd configure
                "subject": f"New Print Order from {order_dict.get('client_name')}",
                "text": message
            }
            resend.Emails.send(params)
        except Exception as e:
            print(f"Failed to send Resend notification: {e}")
