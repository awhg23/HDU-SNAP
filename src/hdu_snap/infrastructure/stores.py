from __future__ import annotations

import json
import logging
import re
from pathlib import Path

from hdu_snap.domain.text import clean_option_text, clean_source_text, normalize_text

logger = logging.getLogger("hdu-snap")

DEFAULT_PATCH_RULES = [
    {"source_text": "伎俩，手段", "answer_text": "dodge", "wrong_answer_text": "strategy", "note": "避免字典把“伎俩，手段”误命中到 strategy"},
    {"source_text": "离散的", "answer_text": "discrete", "wrong_answer_text": "separate", "note": "避免字典把“离散的”误命中到 separate"},
    {"source_text": "overall", "answer_text": "套装", "wrong_answer_text": "工装裤", "note": "避免字典把“overall”误命中到 工装裤"},
    {"source_text": "pitch", "answer_text": "高音", "wrong_answer_text": "曲调", "note": "避免字典把“pitch”误命中到 曲调"},
    {"source_text": "新闻", "answer_text": "news", "wrong_answer_text": "information", "note": "避免字典把“新闻”误命中到 information"},
    {"source_text": "抑制", "answer_text": "check", "wrong_answer_text": "block", "note": "避免字典把“抑制”误命中到 block"},
]

class PatchRuleStore:
    TEMPLATE_PREFIX = """// HDU-SNAP 补丁区
// 这个文件用于存放已确认错题的补丁规则。
// 桌面 App 可通过手动添加、导入或结果页“记录错题”维护规则。
// 模板：
// {
//   "source_text": "解决",
//   "answer_text": "resolve",
//   "wrong_answer_text": "dissolve",
//   "note": "避免词库命中到 dissolve"
// }
"""

    def __init__(self, path: Path, seed_defaults: bool = True) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_file()
        self.rules = self._load_rules()
        if seed_defaults:
            self.seed_missing_sources(DEFAULT_PATCH_RULES)

    def _ensure_file(self) -> None:
        if not self.path.exists():
            self.path.write_text(
                self.TEMPLATE_PREFIX + json.dumps({"rules": []}, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )

    @staticmethod
    def _strip_jsonc_comments(text: str) -> str:
        text = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)
        return "\n".join(line for line in text.splitlines() if not re.match(r"^\s*//", line))

    def _load_rules(self) -> list[dict[str, str]]:
        try:
            payload = json.loads(self._strip_jsonc_comments(self.path.read_text(encoding="utf-8")) or "{}")
        except Exception as exc:
            logger.warning("failed to load patch rules from %s: %s", self.path, exc)
            return []
        rules = payload.get("rules", []) if isinstance(payload, dict) else payload
        normalized: list[dict[str, str]] = []
        for rule in rules if isinstance(rules, list) else []:
            if not isinstance(rule, dict):
                continue
            source = str(rule.get("source_text", "")).strip()
            answer = str(rule.get("answer_text", "")).strip()
            if source and answer:
                normalized.append(
                    {
                        "source_text": source,
                        "answer_text": answer,
                        "wrong_answer_text": str(rule.get("wrong_answer_text", "")).strip(),
                        "note": str(rule.get("note", "")).strip(),
                    }
                )
        return normalized

    def get_rules(self) -> list[dict[str, str]]:
        return list(self.rules)

    def save(self) -> None:
        self.path.write_text(
            self.TEMPLATE_PREFIX + json.dumps({"rules": self.rules}, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    def upsert_rule(self, source_text: str, answer_text: str, wrong_answer_text: str, note: str) -> None:
        normalized_source = normalize_text(clean_source_text(source_text))
        normalized_answer = normalize_text(clean_option_text(answer_text))
        if not normalized_source or not normalized_answer:
            return
        new_rule = {
            "source_text": source_text.strip(),
            "answer_text": answer_text.strip(),
            "wrong_answer_text": wrong_answer_text.strip(),
            "note": note.strip(),
        }
        for index, rule in enumerate(self.rules):
            existing_source = normalize_text(clean_source_text(rule["source_text"]))
            existing_answer = normalize_text(clean_option_text(rule["answer_text"]))
            if existing_source == normalized_source and existing_answer == normalized_answer:
                self.rules[index] = new_rule
                self.save()
                return
        self.rules.append(new_rule)
        self.save()

    def replace_source_rule(
        self,
        source_text: str,
        answer_text: str,
        wrong_answer_text: str,
        note: str,
    ) -> None:
        normalized_source = normalize_text(clean_source_text(source_text))
        if not normalized_source:
            return
        self.rules = [
            rule
            for rule in self.rules
            if normalize_text(clean_source_text(rule["source_text"])) != normalized_source
        ]
        self.upsert_rule(source_text, answer_text, wrong_answer_text, note)

    def delete_rule(self, source_text: str, answer_text: str) -> bool:
        key = (
            normalize_text(clean_source_text(source_text)),
            normalize_text(clean_option_text(answer_text)),
        )
        before = len(self.rules)
        self.rules = [
            rule
            for rule in self.rules
            if (
                normalize_text(clean_source_text(rule["source_text"])),
                normalize_text(clean_option_text(rule["answer_text"])),
            )
            != key
        ]
        if len(self.rules) == before:
            return False
        self.save()
        return True

    def seed_defaults(self, rules: list[dict[str, str]]) -> None:
        changed = False
        existing = {
            (
                normalize_text(clean_source_text(rule["source_text"])),
                normalize_text(clean_option_text(rule["answer_text"])),
            )
            for rule in self.rules
        }
        for rule in rules:
            key = (
                normalize_text(clean_source_text(rule["source_text"])),
                normalize_text(clean_option_text(rule["answer_text"])),
            )
            if key in existing:
                continue
            self.rules.append(dict(rule))
            existing.add(key)
            changed = True
        if changed:
            self.save()

    def seed_missing_sources(self, rules: list[dict[str, str]]) -> None:
        """Add packaged baseline rules without replacing user-owned source rules."""
        changed = False
        existing_sources = {
            normalize_text(clean_source_text(rule["source_text"]))
            for rule in self.rules
        }
        for rule in rules:
            source = str(rule.get("source_text", "")).strip()
            answer = str(rule.get("answer_text", "")).strip()
            source_key = normalize_text(clean_source_text(source))
            answer_key = normalize_text(clean_option_text(answer))
            if not source_key or not answer_key or source_key in existing_sources:
                continue
            self.rules.append(
                {
                    "source_text": source,
                    "answer_text": answer,
                    "wrong_answer_text": str(rule.get("wrong_answer_text", "")).strip(),
                    "note": str(rule.get("note", "")).strip(),
                }
            )
            existing_sources.add(source_key)
            changed = True
        if changed:
            self.save()
