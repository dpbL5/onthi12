import tempfile
import requests
import os
import hashlib
import time

CLOUDINARY_CLOUD_NAME = 'dvwkjiz2i'
CLOUDINARY_UPLOAD_PRESET = 'nvh_upload'
CLOUDINARY_URL = f"https://api.cloudinary.com/v1_1/{CLOUDINARY_CLOUD_NAME}/auto/upload"

def upload_to_cloudinary(file_bytes_or_path, file_name=None, resource_type='auto'):
    # ... existing implementation ...
    files = {}
    if isinstance(file_bytes_or_path, str) and os.path.exists(file_bytes_or_path):
        files['file'] = open(file_bytes_or_path, 'rb')
    elif isinstance(file_bytes_or_path, bytes):
        files['file'] = (file_name or 'upload.png', file_bytes_or_path)
    else:
        raise ValueError("Invalid file data")
    
    data = {
        'upload_preset': CLOUDINARY_UPLOAD_PRESET,
    }
    
    url = f"https://api.cloudinary.com/v1_1/{CLOUDINARY_CLOUD_NAME}/{resource_type}/upload"
    
    try:
        resp = requests.post(url, data=data, files=files)
        resp.raise_for_status()
        res_json = resp.json()
        return {
            'secure_url': res_json.get('secure_url'),
            'public_id': res_json.get('public_id')
        }
    except Exception as e:
        print(f"Cloudinary upload failed: {e}")
        return None
    finally:
        if isinstance(file_bytes_or_path, str) and 'file' in files:
            files['file'].close()

def delete_from_cloudinary(public_id, resource_type='image'):
    """
    Xoá file khỏi Cloudinary bằng public_id.
    Yêu cầu cấu hình CLOUDINARY_API_KEY và CLOUDINARY_API_SECRET trong .env.
    """
    api_key = os.getenv('CLOUDINARY_API_KEY')
    api_secret = os.getenv('CLOUDINARY_API_SECRET')
    cloud_name = os.getenv('CLOUDINARY_CLOUD_NAME', CLOUDINARY_CLOUD_NAME)
    
    if not api_key or not api_secret:
        # Silently fail if not configured to avoid breaking the app
        print("Cloudinary API Key/Secret missing. Skipping deletion.")
        return False
        
    timestamp = int(time.time())
    
    # Signature logic: sort parameters alphabetically
    # In this case: public_id, timestamp
    params_to_sign = f"public_id={public_id}&timestamp={timestamp}{api_secret}"
    signature = hashlib.sha1(params_to_sign.encode('utf-8')).hexdigest()
    
    url = f"https://api.cloudinary.com/v1_1/{cloud_name}/{resource_type}/destroy"
    payload = {
        'public_id': public_id,
        'timestamp': timestamp,
        'api_key': api_key,
        'signature': signature
    }
    
    try:
        resp = requests.post(url, data=payload)
        resp.raise_for_status()
        res_json = resp.json()
        print(f"Cloudinary destroy result for {public_id}: {res_json.get('result')}")
        return res_json.get('result') == 'ok'
    except Exception as e:
        print(f"Cloudinary deletion failed for {public_id}: {e}")
        return False
