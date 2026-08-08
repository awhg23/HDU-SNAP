from __future__ import annotations

import json
import logging
import sqlite3
from pathlib import Path

from hdu_snap.domain.models import DictionaryLookupResult, TierDecision
from hdu_snap.domain.text import contains_chinese, normalize_chinese_gloss, normalize_text, split_glosses

logger = logging.getLogger("hdu-snap")


class DictionaryEngine:
    def __init__(self, db_path: Path, cache_path: Path) -> None:
        self.db_path = db_path
        self.cache_path = cache_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize_database()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.db_path)
        connection.row_factory = sqlite3.Row
        return connection

    def _initialize_database(self) -> None:
        with self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS dictionary_entries (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    word TEXT NOT NULL,
                    normalized_word TEXT NOT NULL,
                    translation TEXT NOT NULL,
                    normalized_translation TEXT NOT NULL,
                    source TEXT NOT NULL,
                    UNIQUE(normalized_word, normalized_translation, source)
                );
                CREATE INDEX IF NOT EXISTS idx_dictionary_word ON dictionary_entries(normalized_word);
                CREATE TABLE IF NOT EXISTS dictionary_aliases (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    normalized_gloss TEXT NOT NULL,
                    word TEXT NOT NULL,
                    normalized_word TEXT NOT NULL,
                    translation TEXT NOT NULL,
                    source TEXT NOT NULL,
                    UNIQUE(normalized_gloss, normalized_word, source)
                );
                CREATE INDEX IF NOT EXISTS idx_dictionary_alias_gloss ON dictionary_aliases(normalized_gloss);
                """
            )
        self._load_cache_file()

    def _load_cache_file(self) -> None:
        if not self.cache_path.exists():
            raise FileNotFoundError(f"未找到词库缓存文件：{self.cache_path}")
        payload = json.loads(self.cache_path.read_text(encoding="utf-8"))
        entries = payload.get("entries", [])
        records: list[tuple[str, str, str, str, str]] = []
        aliases: list[tuple[str, str, str, str, str]] = []
        source_name = self.cache_path.name
        for item in entries:
            word = str(item.get("word", "")).strip()
            if not word:
                continue
            normalized_word = normalize_text(item.get("normalized_word") or word)
            raw_meaning = str(item.get("raw_meaning", "")).strip()
            chinese_terms = [
                normalize_chinese_gloss(term)
                for term in item.get("chinese_terms", [])
                if normalize_chinese_gloss(term)
            ]
            candidates = ([raw_meaning] if raw_meaning else []) + (["；".join(chinese_terms)] if chinese_terms else [])
            for translation in candidates:
                records.append((word, normalized_word, translation, normalize_chinese_gloss(translation), source_name))
            alias_values = set(chinese_terms)
            if raw_meaning:
                alias_values.add(normalize_chinese_gloss(raw_meaning))
                alias_values.update(split_glosses(raw_meaning))
            for alias in alias_values:
                if alias:
                    aliases.append((alias, word, normalized_word, raw_meaning or "；".join(chinese_terms), source_name))
        with self._connect() as connection:
            connection.executemany(
                "INSERT OR IGNORE INTO dictionary_entries "
                "(word, normalized_word, translation, normalized_translation, source) VALUES (?, ?, ?, ?, ?)",
                records,
            )
            connection.executemany(
                "INSERT OR IGNORE INTO dictionary_aliases "
                "(normalized_gloss, word, normalized_word, translation, source) VALUES (?, ?, ?, ?, ?)",
                aliases,
            )
        logger.info("dictionary ready from cache file: %s entries loaded into %s", len(entries), self.db_path)

    def lookup_exact(self, source_text: str, options: dict[str, str]) -> DictionaryLookupResult:
        normalized_source = normalize_text(source_text)
        if not normalized_source:
            return DictionaryLookupResult()
        if contains_chinese(source_text):
            candidates = {letter: normalize_text(text) for letter, text in options.items()}
            with self._connect() as connection:
                rows = connection.execute(
                    "SELECT word, translation, source FROM dictionary_aliases WHERE normalized_gloss = ?",
                    (normalized_source,),
                ).fetchall()
            matches: dict[str, sqlite3.Row] = {}
            for row in rows:
                for letter, option in candidates.items():
                    if option == normalize_text(row["word"]):
                        matches.setdefault(letter, row)
            return self._result_from_matches(source_text, matches, value_column="word")

        candidates = {letter: normalize_chinese_gloss(text) for letter, text in options.items()}
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT translation, normalized_translation, source FROM dictionary_entries WHERE normalized_word = ?",
                (normalized_source,),
            ).fetchall()
        matches: dict[str, sqlite3.Row] = {}
        for row in rows:
            aliases = {row["normalized_translation"], *split_glosses(row["translation"])}
            for letter, option in candidates.items():
                if option in aliases:
                    matches.setdefault(letter, row)
        return self._result_from_matches(source_text, matches, value_column="translation")

    @staticmethod
    def _result_from_matches(
        source_text: str,
        matches: dict[str, sqlite3.Row],
        value_column: str,
    ) -> DictionaryLookupResult:
        if len(matches) >= 2:
            return DictionaryLookupResult(
                force_tier3=True,
                force_reason=f"Tier1冲突: 命中多个候选项 {','.join(sorted(matches))}",
            )
        if len(matches) == 1:
            letter, row = next(iter(matches.items()))
            return DictionaryLookupResult(
                decision=TierDecision(
                    target=letter,
                    method="字典匹配",
                    confidence=1.0,
                    detail=f"{source_text} -> {row[value_column]} ({row['source']})",
                )
            )
        return DictionaryLookupResult()

    def fetch_translations(self, source_text: str) -> list[str]:
        normalized_source = normalize_text(source_text)
        if not normalized_source:
            return []
        with self._connect() as connection:
            if contains_chinese(source_text):
                rows = connection.execute(
                    "SELECT DISTINCT word FROM dictionary_aliases WHERE normalized_gloss = ? ORDER BY id ASC",
                    (normalized_source,),
                ).fetchall()
                return [str(row["word"]) for row in rows]
            rows = connection.execute(
                "SELECT DISTINCT translation FROM dictionary_entries WHERE normalized_word = ? ORDER BY id ASC",
                (normalized_source,),
            ).fetchall()
            return [str(row["translation"]) for row in rows]
