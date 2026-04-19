from sqlmodel import SQLModel, Field
from datetime import datetime, timezone
import uuid
from typing import Optional

def get_utc_now():
    return datetime.now(timezone.utc)

class ClientUser(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    username: str = Field(unique=True, index=True)
    password_hash: str
    created_at: datetime = Field(default_factory=get_utc_now)

class Order(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    client_id: Optional[uuid.UUID] = Field(default=None, foreign_key="clientuser.id")
    client_name: str
    contact_email: str
    contact_phone: Optional[str] = None
    copies: int = Field(default=1)
    color_mode: str # e.g., "bw" or "color"
    paper_size: str # e.g., "A4", "A3", "Letter"
    file_key: str # Reference to S3 object key
    file_name: str # Original file name for display
    status: str = Field(default="pending") # "pending", "printed", "archived"
    created_at: datetime = Field(default_factory=get_utc_now)

class OrderCreate(SQLModel):
    client_name: str
    contact_email: str
    contact_phone: Optional[str] = None
    copies: int
    color_mode: str
    paper_size: str
    file_key: str
    file_name: str

class OrderUpdate(SQLModel):
    status: str
