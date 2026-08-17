from __future__ import annotations

from dataclasses import dataclass

from hdu_snap.application.solver import SolverPipeline
from hdu_snap.config import Settings
from hdu_snap.domain.models import RunStats, RuntimeOptions
from hdu_snap.infrastructure.dictionary import DictionaryEngine
from hdu_snap.infrastructure.models import LLMEngine
from hdu_snap.infrastructure.stores import DebugArtifactStore, PatchRuleStore, migrate_legacy_debug_files


@dataclass
class ServiceContainer:
    settings: Settings
    runtime: RuntimeOptions
    dictionary_engine: DictionaryEngine
    llm_engine: LLMEngine
    patch_store: PatchRuleStore
    debug_store: DebugArtifactStore

    @classmethod
    def create(cls, settings: Settings, runtime: RuntimeOptions) -> "ServiceContainer":
        migrate_legacy_debug_files(settings.resolved_data_dir)
        debug_store = DebugArtifactStore(settings.debug_recent_path, settings.debug_error_path)
        patch_store = PatchRuleStore(settings.resolved_patch_rules_path)
        dictionary_engine = DictionaryEngine(settings.database_path, settings.resolved_dictionary_path)
        llm_engine = LLMEngine(
            api_key=settings.deepseek_api_key,
            base_url=settings.llm_base_url,
            model=settings.llm_model,
            timeout_seconds=settings.llm_timeout_seconds,
            max_retries=settings.llm_max_retries,
        )
        return cls(
            settings=settings,
            runtime=runtime,
            dictionary_engine=dictionary_engine,
            llm_engine=llm_engine,
            patch_store=patch_store,
            debug_store=debug_store,
        )

    def build_pipeline(self) -> SolverPipeline:
        return SolverPipeline(
            dictionary_engine=self.dictionary_engine,
            llm_engine=self.llm_engine,
            patch_store=self.patch_store,
            debug_store=self.debug_store,
            runtime=self.runtime,
            stats=RunStats(),
        )
