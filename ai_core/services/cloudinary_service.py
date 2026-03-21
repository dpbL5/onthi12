import tempfile
import requests
import os

CLOUDINARY_CLOUD_NAME = 'dvwkjiz2i'
CLOUDINARY_UPLOAD_PRESET = 'nvh_upload'
CLOUDINARY_URL = f"https://api.cloudinary.com/v1_1/{CLOUDINARY_CLOUD_NAME}/image/upload"

def upload_to_cloudinary(file_bytes_or_path, file_name=None):
    """
    Tải ảnh lên Cloudinary qua REST API trả về secure_url.
    Hỗ trợ truyền đường dẫn file (str) hoặc dữ liệu nhị phân (bytes).
    """
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
    
    try:
        resp = requests.post(CLOUDINARY_URL, data=data, files=files)
        resp.raise_for_status()
        return resp.json().get('secure_url')
    except Exception as e:
        print(f"Cloudinary upload failed: {e}")
        return None
    finally:
        if isinstance(file_bytes_or_path, str) and 'file' in files:
            files['file'].close()
