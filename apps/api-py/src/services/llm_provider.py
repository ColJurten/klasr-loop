"""Secret-bearing LLM construction lives here; DSA sees only a callable adapter."""

import asyncio
import os

import httpx
from crewai import BaseLLM
from core.settings import get_settings
from services.llm_settings import ProviderClientService


class CallableLLM(BaseLLM):
    def __init__(self, complete):
        super().__init__(model="klasr-provider")
        self._complete = complete

    def call(self, messages, **_kwargs):
        return self._complete(messages)

    def supports_function_calling(self):
        return False


def environment_config(agent_name=""):
    def setting(name):
        return os.getenv(f"KLASR_LLM_{name}_{agent_name.upper()}") or os.getenv(f"KLASR_LLM_{name}")

    provider, model = setting("PROVIDER"), setting("MODEL")
    if not provider or not model:
        raise ValueError("KLASR_LLM_PROVIDER and KLASR_LLM_MODEL are required")
    return dict(
        provider=provider, model=model, apiKey=setting("API_KEY") or "", baseUrl=setting("BASE_URL")
    )


def environment_llm(agent_name):
    config = environment_config(agent_name)

    async def completion(messages):
        async with httpx.AsyncClient() as client:
            return await ProviderClientService(get_settings(), client).completion(config, messages)

    return CallableLLM(lambda messages: asyncio.run(completion(messages)))
