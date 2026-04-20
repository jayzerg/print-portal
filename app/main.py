import secrets
from contextlib import asynccontextmanager
from typing import List, Optional

from fastapi import FastAPI, Depends, HTTPException, status, Request, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse
from sqlmodel import Session, select
from pydantic import BaseModel

from .config import settings
from .database import engine, get_session, create_db_and_tables
from .models import Order, OrderCreate, OrderUpdate, ClientUser
from .storage import generate_presigned_post, generate_download_url
from .auth import get_password_hash, verify_password, create_access_token, get_current_client, get_optional_client, ACCESS_TOKEN_EXPIRE_MINUTES
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import text
from .notifications import notify_admin
from .scheduler import start_scheduler, stop_scheduler

security = HTTPBasic()

def verify_admin(credentials: HTTPBasicCredentials = Depends(security)):
    is_user_ok = secrets.compare_digest(credentials.username, settings.ADMIN_USERNAME)
    is_pass_ok = secrets.compare_digest(credentials.password, settings.ADMIN_PASSWORD)
    if not (is_user_ok and is_pass_ok):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Basic"},
        )
    return credentials.username

@asynccontextmanager
async def lifespan(app: FastAPI):
    create_db_and_tables()
    with Session(engine) as session:
        try:
            # Recreate the column properly as UUID with a foreign key constraint to avoid type mismatch
            session.exec(text('ALTER TABLE "order" DROP COLUMN IF EXISTS client_id'))
            session.exec(text('ALTER TABLE "order" ADD COLUMN client_id UUID REFERENCES clientuser(id)'))
            session.commit()
        except Exception as e:
            print(f"Warning during DB Migration: {e}")
            session.rollback()
    start_scheduler()
    yield
    stop_scheduler()

app = FastAPI(title="Print Service Portal", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class PresignedRequest(BaseModel):
    filename: str

@app.post("/api/upload/presigned")
def get_presigned_url(request: PresignedRequest):
    try:
        presigned_info, secure_filename = generate_presigned_post(request.filename)
        presigned_info["filename"] = secure_filename
        return presigned_info
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail="Internal server error generating upload URL.")

@app.post("/api/orders", response_model=Order)
def create_order(
    order_in: OrderCreate, 
    background_tasks: BackgroundTasks, 
    client: Optional[ClientUser] = Depends(get_optional_client),
    session: Session = Depends(get_session)
):
    try:
        order = Order.model_validate(order_in)
        if client:
            order.client_id = client.id
        session.add(order)
        session.commit()
        session.refresh(order)
        
        dl_url = generate_download_url(order.file_key)
        
        # Dispatch notification
        background_tasks.add_task(notify_admin, order.model_dump(), dl_url)
        return order
    except Exception as e:
        session.rollback()
        raise HTTPException(status_code=500, detail="Failed to save order.")

@app.get("/api/admin/orders", response_model=List[Order])
def list_orders(
    session: Session = Depends(get_session),
    admin: str = Depends(verify_admin)
):
    statement = select(Order).order_by(Order.created_at.desc())
    return session.exec(statement).all()

import uuid

@app.patch("/api/admin/orders/{order_id}/status")
def update_order_status(
    order_id: uuid.UUID,
    update_data: OrderUpdate,
    session: Session = Depends(get_session),
    admin: str = Depends(verify_admin)
):
    order = session.get(Order, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
        
    order.status = update_data.status
    session.add(order)
    session.commit()
    session.refresh(order)
    return order

@app.get("/api/admin/orders/{order_id}/download")
def get_download_link(
    order_id: uuid.UUID,
    session: Session = Depends(get_session),
    admin: str = Depends(verify_admin)
):
    order = session.get(Order, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
        
    try:
        url = generate_download_url(order.file_key)
        return {"url": url}
    except Exception as e:
        raise HTTPException(status_code=500, detail="Could not generate download link")

app.mount("/static", StaticFiles(directory="frontend/static"), name="static")

from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

@app.get("/")
def serve_index():
    with open("frontend/index.html", "r", encoding="utf-8") as f:
        return HTMLResponse(content=f.read())

@app.get("/client")
def redirect_client():
    return RedirectResponse(url="/")

@app.get("/admin")
def serve_admin(admin: str = Depends(verify_admin)):
    with open("frontend/admin.html", "r", encoding="utf-8") as f:
        return HTMLResponse(content=f.read())

class UserCreate(BaseModel):
    username: str
    password: str

@app.post("/api/auth/register")
def register(user: UserCreate, session: Session = Depends(get_session)):
    existing = session.exec(select(ClientUser).where(ClientUser.username == user.username)).first()
    if existing:
        raise HTTPException(status_code=400, detail="Username already registered")
    
    new_user = ClientUser(
        username=user.username,
        password_hash=get_password_hash(user.password)
    )
    session.add(new_user)
    session.commit()
    return {"message": "User registered successfully"}

@app.post("/api/auth/login")
def login(form_data: OAuth2PasswordRequestForm = Depends(), session: Session = Depends(get_session)):
    user = session.exec(select(ClientUser).where(ClientUser.username == form_data.username)).first()
    if not user or not verify_password(form_data.password, user.password_hash):
        raise HTTPException(status_code=400, detail="Incorrect username or password")
    
    access_token = create_access_token(data={"sub": user.username})
    return {"access_token": access_token, "token_type": "bearer"}

@app.get("/api/client/orders", response_model=List[Order])
def list_client_orders(client: Optional[ClientUser] = Depends(get_optional_client), session: Session = Depends(get_session)):
    if not client:
        return []
    statement = select(Order).where(Order.client_id == client.id).order_by(Order.created_at.desc())
    return session.exec(statement).all()

@app.api_route("/health", methods=["GET", "HEAD"])
def health_check():
    """Lightweight endpoint to keep the server alive on Render."""
    return {"status": "ok"}

