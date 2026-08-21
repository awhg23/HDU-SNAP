from __future__ import annotations

from dataclasses import dataclass

from hdu_snap.application.solver import SolverPipeline
from hdu_snap.config import Settings
from hdu_snap.domain.models import RunStats
from hdu_snap.infrastructure.dictionary import DictionaryEngine
from hdu_snap.infrastructure.models import LLMEngine
from hdu_snap.infrastructure.stores import PatchRuleStore


@dataclass
class ServiceContainer:
    settings: Settings
    dictionary_engine: DictionaryEngine
    llm_engine: LLMEngine
    patch_store: PatchRuleStore

    @classmethod
    def create(cls, settings: Settings) -> "ServiceContainer":
        return cls(
            settings=settings,
            dictionary_engine=DictionaryEngine(settings.database_path, settings.resolved_dictionary_path),
            llm_engine=LLMEngine(
                api_key=settings.deepseek_api_key,
                base_url=settings.llm_base_url,
                model=settings.llm_model,
                timeout_seconds=settings.llm_timeout_seconds,
                max_retries=settings.llm_max_retries,
            ),
            patch_store=PatchRuleStore(settings.resolved_patch_rules_path),
        )

    def build_pipeline(self) -> SolverPipeline:
        return SolverPipeline(
            dictionary_engine=self.dictionary_engine,
            llm_engine=self.llm_engine,
            patch_store=self.patch_store,
            stats=RunStats(),
        )
