import os
from typing import Any, Dict, List

from google import genai

API_KEY = os.environ.get('GEMINI_API_KEY')
DEFAULT_MODEL = os.environ.get('GEMINI_MODEL_NAME', 'gemini-2.5-flash')
_EMBED_MODEL = os.environ.get('GEMINI_EMBED_MODEL', 'gemini-embedding-001')

_client = genai.Client(api_key=API_KEY) if API_KEY else None


def is_configured() -> bool:
    return _client is not None


def get_default_model() -> str:
    return DEFAULT_MODEL


def generate_content(contents: Any, model: str | None = None, config: Dict[str, Any] | None = None):
    if _client is None:
        raise ValueError('GEMINI_API_KEY is not configured.')
    kwargs = {
        'model': model or DEFAULT_MODEL,
        'contents': contents,
    }
    if config:
        kwargs['config'] = config
    return _client.models.generate_content(**kwargs)


def embed_content(content: str, task_type: str, output_dimensionality: int = 768, model: str | None = None) -> List[float]:
    if _client is None:
        raise ValueError('GEMINI_API_KEY is not configured.')

    response = _client.models.embed_content(
        model=model or _EMBED_MODEL,
        contents=content,
        config={
            'task_type': task_type,
            'output_dimensionality': output_dimensionality,
        },
    )

    if not response.embeddings:
        raise ValueError('Embedding response is empty.')

    return list(response.embeddings[0].values)


def upload_file(path: str):
    if _client is None:
        raise ValueError('GEMINI_API_KEY is not configured.')
    return _client.files.upload(file=path)


def delete_file(file_name: str) -> None:
    if _client is None:
        return
    _client.files.delete(name=file_name)


def list_models() -> list[str]:
    if _client is None:
        raise ValueError('GEMINI_API_KEY is not configured.')
    return [m.name for m in _client.models.list()]
