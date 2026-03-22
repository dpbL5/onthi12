import os
import hashlib
from typing import Any, Dict, List

from google import genai

try:
    from django.core.cache import cache as django_cache
except Exception:
    django_cache = None

API_KEY = os.environ.get('GEMINI_API_KEY')
DEFAULT_MODEL = os.environ.get('GEMINI_MODEL_NAME', 'gemini-3.1-flash-lite-preview')
_EMBED_MODEL = os.environ.get('GEMINI_EMBED_MODEL', 'gemini-embedding-001')
EMBED_CACHE_TTL = int(os.environ.get('GEMINI_EMBED_CACHE_TTL', '21600'))

_client = genai.Client(api_key=API_KEY) if API_KEY else None


def _make_embed_cache_key(model: str, task_type: str, output_dimensionality: int, content: str) -> str:
    payload = f"{model}|{task_type}|{output_dimensionality}|{content}"
    digest = hashlib.sha256(payload.encode('utf-8')).hexdigest()
    return f"gemini:embed:{digest}"


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


def embed_content(
    content: str,
    task_type: str,
    output_dimensionality: int = 768,
    model: str | None = None,
    use_cache: bool = True,
    cache_ttl: int | None = None,
) -> List[float]:
    if _client is None:
        raise ValueError('GEMINI_API_KEY is not configured.')

    selected_model = model or _EMBED_MODEL

    if use_cache and django_cache is not None:
        cache_key = _make_embed_cache_key(
            model=selected_model,
            task_type=task_type,
            output_dimensionality=output_dimensionality,
            content=content,
        )
        cached_vector = django_cache.get(cache_key)
        if isinstance(cached_vector, list) and cached_vector:
            return cached_vector

    response = _client.models.embed_content(
        model=selected_model,
        contents=content,
        config={
            'task_type': task_type,
            'output_dimensionality': output_dimensionality,
        },
    )

    if not response.embeddings:
        raise ValueError('Embedding response is empty.')

    vector = list(response.embeddings[0].values)

    if use_cache and django_cache is not None:
        ttl = EMBED_CACHE_TTL if cache_ttl is None else cache_ttl
        django_cache.set(cache_key, vector, timeout=ttl)

    return vector


def upload_file(path: str, mime_type: str | None = None):
    if _client is None:
        raise ValueError('GEMINI_API_KEY is not configured.')
    kwargs = {'file': path}
    if mime_type:
        kwargs['config'] = {'mime_type': mime_type}
    return _client.files.upload(**kwargs)


def delete_file(file_name: str) -> None:
    if _client is None:
        return
    _client.files.delete(name=file_name)


def list_models() -> list[str]:
    if _client is None:
        raise ValueError('GEMINI_API_KEY is not configured.')
    return [m.name for m in _client.models.list()]
