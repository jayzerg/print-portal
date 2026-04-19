import boto3
from botocore.exceptions import ClientError
from botocore.config import Config
from .config import settings
import uuid
import mimetypes

# Define strictly allowed types from prompt
ALLOWED_EXTENSIONS = {'.doc', '.docx', '.pdf'}

def get_s3_client():
    return boto3.client(
        "s3",
        endpoint_url=settings.R2_ENDPOINT_URL.rstrip("/"),
        aws_access_key_id=settings.R2_ACCESS_KEY,
        aws_secret_access_key=settings.R2_SECRET_KEY,
        region_name="auto", # Cloudflare R2 standard
        config=Config(s3={'addressing_style': 'path'}, signature_version='s3v4')
    )

def generate_presigned_post(filename: str):
    # Ensure strict extension
    ext = ""
    for allowed in ALLOWED_EXTENSIONS:
        if filename.lower().endswith(allowed):
            ext = allowed
            break
            
    if not ext:
        raise ValueError(f"Invalid file extension. Allowed: {', '.join(ALLOWED_EXTENSIONS)}")

    # Generate unique filename to prevent overwrites
    secure_filename = f"{uuid.uuid4().hex}_{filename}"
    
    try:
        s3_client = get_s3_client()
        
        # We generate a presigned PUT URL. 
        # The browser will send the raw file bytes directly to this URL.
        content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        
        url = s3_client.generate_presigned_url(
            ClientMethod='put_object',
            Params={
                'Bucket': settings.R2_BUCKET_NAME,
                'Key': secure_filename,
                'ContentType': content_type
            },
            ExpiresIn=3600
        )
        
        # Return in a format the frontend expects for PUT
        return {"url": url, "method": "PUT", "content_type": content_type}, secure_filename
        
    except ClientError as e:
        print(f"Boto3 Error: {e}")
        raise ValueError("Failed to generate secure upload token")

def generate_download_url(file_key: str, expires: int = 86400):
    s3_client = get_s3_client()
    try:
        url = s3_client.generate_presigned_url(
            "get_object",
            Params={"Bucket": settings.R2_BUCKET_NAME, "Key": file_key},
            ExpiresIn=expires
        )
        return url
    except ClientError as e:
        raise Exception(f"Failed to generate download URL: {e}")

def delete_file(file_key: str):
    s3_client = get_s3_client()
    try:
        s3_client.delete_object(Bucket=settings.R2_BUCKET_NAME, Key=file_key)
    except ClientError as e:
        # We just log it if we fail to delete during cleanup
        print(f"Error deleting file {file_key}: {e}")
