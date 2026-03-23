import os

from . import gemini_client

try:
    from . import openai_client
except ImportError:
    openai_client = None


def get_provider_name():
    return os.environ.get('AI_PROVIDER', 'openai').strip().lower()


def get_client():
    provider = get_provider_name()
    if provider == 'openai' and openai_client is not None:
        return openai_client
    if provider == 'gemini' and gemini_client is not None:
        return gemini_client
    # Default to openai if available
    if openai_client is not None:
        return openai_client
    return gemini_client
