# Print Service Portal

A lightweight and secure file submission portal for printing services. It directly uploads files from the browser to Cloudflare R2 using AWS Boto3 Presigned posts, minimizing server bottleneck risks and preventing memory timeouts. The metadata correctly maps into a PostgreSQL database, triggered via a fast ASGI application built on FastAPI.

## Tech Stack
- **Backend**: Python 3.10+, FastAPI, SQLModel (PostgreSQL)
- **Storage**: Cloudflare R2 / S3
- **Notifications**: Resend Desktop API / Telegram Bot API
- **Frontend**: Vanilla HTML5, CSS3, ES6 JavaScript

## Setup & Local Run

### 1. Install Dependencies
```bash
pip install -r requirements.txt
```

### 2. Configure Environment Variables
Copy the `.env.example` to `.env` and fill in the values:
```bash
cp .env.example .env
# Edit .env with your favorite editor
```

### 3. Run the Development Server
```bash
uvicorn app.main:app --reload
```
The application will automatically initialize the database schema on start.
It will be available at: `http://localhost:8000`
Admin panel: `http://localhost:8000/admin` (Uses HTTP Basic Auth)

## Deployment (Railway / Render)
1. Provide a managed PostgreSQL database (Neon, Supabase, Railway DB).
2. Attach the connection string to `DATABASE_URL`.
3. Set your Start Command to: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
4. Deploy.

⚠️ Note: The storage is Cloudflare R2, not persistent disk storage, so it will not experience memory wipes on ephemeral PaaS.
