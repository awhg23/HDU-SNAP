import asyncio
import atexit
import json
import logging
import os
import platform
import re
import shutil
import sqlite3
import subprocess
import sys
import time
import warnings
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

warnings.filterwarnings(
    "ignore",
    message=r"urllib3 v2 only supports OpenSSL 1\.1\.1\+.*LibreSSL.*",
)

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

try:
    from urllib3.exceptions import NotOpenSSLWarning
except Exception:  # pragma: no cover - optional import
    NotOpenSSLWarning = None

try:
    from openai import AsyncOpenAI
except ImportError:  # pragma: no cover - optional dependency in scaffold stage
    AsyncOpenAI = None  # type: ignore[assignment]

try:
    from sentence_transformers import SentenceTransformer
except ImportError:  # pragma: no cover - optional dependency in scaffold stage
    SentenceTransformer = None  # type: ignore[assignment]


if NotOpenSSLWarning is not None:
    warnings.filterwarnings("ignore", category=NotOpenSSLWarning)


LETTER_ORDER = ("A", "B", "C", "D")
VECTOR_MARGIN_THRESHOLD = 0.10
VECTOR_TOP_SCORE_THRESHOLD = 0.78
PROJECT_ROOT = Path(__file__).resolve().parent
DEFAULT_DB_PATH = PROJECT_ROOT / "runtime" / "hdu_snap.db"
REFERENCE_WORD_CACHE_PATH = PROJECT_ROOT / "CET" / "Data.lexicon.cache.json"
DEFAULT_EMBEDDING_MODEL = "moka-ai/m3e-base"
DEFAULT_EMBEDDING_MODEL_DIR = PROJECT_ROOT / ".models" / "moka-ai_m3e-base"
DEEPSEEK_BASE_URL = "https://api.deepseek.com"
DEEPSEEK_MODEL = "deepseek-chat"
DEFAULT_TARGET_URL = "https://skl.hduhelp.com/?type=5#/english/list"
FALLBACK_TARGET_URLS = [
    DEFAULT_TARGET_URL,
    "https://skl.hdu.edu.cn/#/english/list",
]
DEBUG_RECENT_10000_PATH = PROJECT_ROOT / "runtime" / "debug_recent_10000.json"
DEBUG_ERROR_1000_PATH = PROJECT_ROOT / "runtime" / "debug_error_1000.json"
PATCH_RULES_PATH = PROJECT_ROOT / "patch_rules.jsonc"

LEGACY_DEBUG_PATH_MAPPINGS = (
    (PROJECT_ROOT / "runtime" / "debug_recent_500.json", DEBUG_RECENT_10000_PATH),
    (PROJECT_ROOT / "runtime" / "debug_error_100.json", DEBUG_ERROR_1000_PATH),
)


def load_local_env_file(path: Path) -> None:
    if not path.exists():
        return

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("\"'")
        if key and key not in os.environ:
            os.environ[key] = value


load_local_env_file(PROJECT_ROOT / ".env")


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("hdu-snap")

app = FastAPI(title="HDU-SNAP Backend", version="0.1.0")


def migrate_legacy_debug_files() -> None:
    for old_path, new_path in LEGACY_DEBUG_PATH_MAPPINGS:
        if not old_path.exists() or new_path.exists():
            continue
        try:
            new_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(old_path), str(new_path))
            logger.info("migrated legacy debug file: %s -> %s", old_path, new_path)
        except Exception as exc:
            logger.warning("failed to migrate legacy debug file %s -> %s: %s", old_path, new_path, exc)


migrate_legacy_debug_files()


class SolveItemPayload(BaseModel):
    type: str = "solve_item"
    session_id: Optional[str] = None
    item_id: int
    source_text: str
    options: Dict[str, str]


class BatchCompletePayload(BaseModel):
    type: str = "batch_complete"
    session_id: Optional[str] = None
    total_items: int = 100


class ReviewResultItemPayload(BaseModel):
    item_id: int
    source_text: str
    options: Dict[str, str]
    wrong_target: str
    correct_target: str
    wrong_option_text: str
    correct_option_text: str
    method: Optional[str] = None


class ReviewResultsPayload(BaseModel):
    type: str = "review_results"
    session_id: Optional[str] = None
    errors: List[ReviewResultItemPayload]


class DecisionResponse(BaseModel):
    type: str = "decision"
    session_id: Optional[str] = None
    item_id: int
    target: str
    method: str
    confidence: Optional[float] = None
    detail: Optional[str] = None


class ErrorResponse(BaseModel):
    type: str = "error"
    session_id: Optional[str] = None
    message: str
    item_id: Optional[int] = None


@dataclass
class TierDecision:
    target: str
    method: str
    confidence: Optional[float] = None
    detail: Optional[str] = None


@dataclass
class DictionaryLookupResult:
    decision: Optional["TierDecision"] = None
    force_tier3: bool = False
    force_reason: Optional[str] = None


@dataclass
class VectorScore:
    letter: str
    text: str
    score: float


@dataclass
class RunStats:
    processed_items: int = 0
    ai_call_count: int = 0

    def record_item(self) -> None:
        self.processed_items += 1

    def record_ai_call(self) -> None:
        self.ai_call_count += 1


@dataclass
class RuntimeConfig:
    mode: str = "normal"

    @property
    def is_debug(self) -> bool:
        return self.mode == "debug"


class DebugArtifactStore:
    def __init__(self, recent_path: Path, error_path: Path) -> None:
        self.recent_path = recent_path
        self.error_path = error_path
        self.recent_path.parent.mkdir(parents=True, exist_ok=True)
        self.recent_questions: deque = deque(self._load_file(self.recent_path), maxlen=10000)
        self.error_questions: deque = deque(self._load_file(self.error_path), maxlen=1000)

    def _load_file(self, path: Path) -> List[Dict[str, Any]]:
        if not path.exists():
            return []
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(payload, list):
                return payload
        except Exception as exc:
            logger.warning("failed to load debug artifact file %s: %s", path, exc)
        return []

    def append_recent(self, record: Dict[str, Any]) -> None:
        self.recent_questions.append(record)
        self._write_file(self.recent_path, list(self.recent_questions))

    def append_errors(self, records: List[Dict[str, Any]]) -> None:
        for record in records:
            self.error_questions.append(record)
        self._write_file(self.error_path, list(self.error_questions))

    def _write_file(self, path: Path, payload: List[Dict[str, Any]]) -> None:
        path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )


class PatchRuleStore:
    TEMPLATE_PREFIX = """// HDU-SNAP 补丁区
// 这个文件用于存放已确认错题的补丁规则。
// 调试模式下，输入“题号:正确选项字母”后，系统会自动把错题补到这里。
// 也可以手动补充。模板：
// {
//   "source_text": "解决",
//   "answer_text": "resolve",
//   "wrong_answer_text": "dissolve",
//   "note": "避免词库命中到 dissolve"
// }
"""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_file()
        self.rules = self._load_rules()

    def _ensure_file(self) -> None:
        if self.path.exists():
            return
        self.path.write_text(
            self.TEMPLATE_PREFIX + json.dumps({"rules": []}, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    def _strip_jsonc_comments(self, text: str) -> str:
        text = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)
        cleaned_lines = []
        for line in text.splitlines():
            if re.match(r"^\s*//", line):
                continue
            cleaned_lines.append(line)
        return "\n".join(cleaned_lines)

    def _load_rules(self) -> List[Dict[str, str]]:
        self._ensure_file()
        try:
            payload = json.loads(self._strip_jsonc_comments(self.path.read_text(encoding="utf-8")) or "{}")
        except Exception as exc:
            logger.warning("failed to load patch rules from %s: %s", self.path, exc)
            return []

        rules = payload.get("rules", []) if isinstance(payload, dict) else payload
        normalized_rules = []
        for rule in rules if isinstance(rules, list) else []:
            if not isinstance(rule, dict):
                continue
            source_text = str(rule.get("source_text", "")).strip()
            answer_text = str(rule.get("answer_text", "")).strip()
            if not source_text or not answer_text:
                continue
            normalized_rules.append(
                {
                    "source_text": source_text,
                    "answer_text": answer_text,
                    "wrong_answer_text": str(rule.get("wrong_answer_text", "")).strip(),
                    "note": str(rule.get("note", "")).strip(),
                }
            )
        return normalized_rules

    def get_rules(self) -> List[Dict[str, str]]:
        return list(self.rules)

    def save(self) -> None:
        payload = {"rules": self.rules}
        self.path.write_text(
            self.TEMPLATE_PREFIX + json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
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
            rule_source = normalize_text(clean_source_text(str(rule.get("source_text", ""))))
            rule_answer = normalize_text(clean_option_text(str(rule.get("answer_text", ""))))
            if rule_source == normalized_source and rule_answer == normalized_answer:
                self.rules[index] = new_rule
                self.save()
                return

        self.rules.append(new_rule)
        self.save()

    def seed_defaults(self, rules: List[Dict[str, str]]) -> None:
        changed = False
        for rule in rules:
            source_text = str(rule.get("source_text", "")).strip()
            answer_text = str(rule.get("answer_text", "")).strip()
            if not source_text or not answer_text:
                continue
            normalized_source = normalize_text(clean_source_text(source_text))
            normalized_answer = normalize_text(clean_option_text(answer_text))
            exists = any(
                normalize_text(clean_source_text(str(existing.get("source_text", "")))) == normalized_source
                and normalize_text(clean_option_text(str(existing.get("answer_text", "")))) == normalized_answer
                for existing in self.rules
            )
            if exists:
                continue
            self.rules.append(
                {
                    "source_text": source_text,
                    "answer_text": answer_text,
                    "wrong_answer_text": str(rule.get("wrong_answer_text", "")).strip(),
                    "note": str(rule.get("note", "")).strip(),
                }
            )
            changed = True

        if changed:
            self.save()


def normalize_text(text: str) -> str:
    text = (text or "").strip().lower()
    text = re.sub(r"\s+", "", text)
    text = re.sub(r"[，。；：,.!?！？()（）\[\]{}'\"“”‘’·\-_/\\]", "", text)
    return text


def clean_source_text(text: str) -> str:
    cleaned = " ".join((text or "").split()).strip()
    cleaned = re.sub(r"^QUESTION\s*\d+\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"^第\s*\d+\s*题[：:.\-\s]*", "", cleaned)
    cleaned = re.sub(r"^CET\s*[- ]\s*\d+\s+", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"^(?:CET[- ]?[46])\s+", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"(自动下一题|题卡|上一题|下一题).*$", "", cleaned, flags=re.IGNORECASE)
    cleaned = cleaned.strip(" .。?？:：;；")
    return cleaned


def clean_option_text(text: str) -> str:
    cleaned = " ".join((text or "").split()).strip()
    cleaned = re.sub(r"^[ABCDabcd][.\s:：、\)]\s*", "", cleaned)
    cleaned = cleaned.strip(" .。?？:：;；")
    return cleaned


def contains_chinese(text: str) -> bool:
    return bool(re.search(r"[\u4e00-\u9fff]", text or ""))


def normalize_chinese_gloss(text: str) -> str:
    text = normalize_text(text)
    text = text.replace("；", "，")
    return text


def split_glosses(text: str) -> List[str]:
    chunks = re.split(r"[，;,；/、]|(?:\s+-\s+)", text or "")
    cleaned = [normalize_chinese_gloss(chunk) for chunk in chunks if normalize_chinese_gloss(chunk)]
    return list(dict.fromkeys(cleaned))


def cosine_similarity(a: List[float], b: List[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0

    dot = sum(x * y for x, y in zip(a, b))
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(y * y for y in b) ** 0.5
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def char_ngram_vector(text: str, n: int = 2) -> Dict[str, int]:
    compact = normalize_chinese_gloss(text)
    if not compact:
        return {}
    if len(compact) < n:
        return {compact: 1}

    result: Dict[str, int] = {}
    for index in range(len(compact) - n + 1):
        gram = compact[index : index + n]
        result[gram] = result.get(gram, 0) + 1
    return result


def sparse_cosine_similarity(left: Dict[str, int], right: Dict[str, int]) -> float:
    if not left or not right:
        return 0.0

    keys = set(left) | set(right)
    dot = sum(left.get(key, 0) * right.get(key, 0) for key in keys)
    norm_left = sum(value * value for value in left.values()) ** 0.5
    norm_right = sum(value * value for value in right.values()) ** 0.5
    if norm_left == 0 or norm_right == 0:
        return 0.0
    return dot / (norm_left * norm_right)


runtime_config = RuntimeConfig()
debug_store = DebugArtifactStore(DEBUG_RECENT_10000_PATH, DEBUG_ERROR_1000_PATH)
patch_rule_store = PatchRuleStore(PATCH_RULES_PATH)
patch_rule_store.seed_defaults(
    [
        {
            "source_text": "伎俩，手段",
            "answer_text": "dodge",
            "wrong_answer_text": "strategy",
            "note": "避免字典把“伎俩，手段”误命中到 strategy",
        },
        {
            "source_text": "离散的",
            "answer_text": "discrete",
            "wrong_answer_text": "separate",
            "note": "避免字典把“离散的”误命中到 separate",
        },
        {
            "source_text": "overall",
            "answer_text": "套装",
            "wrong_answer_text": "工装裤",
            "note": "避免字典把“overall”误命中到 工装裤",
        },
        {
            "source_text": "pitch",
            "answer_text": "高音",
            "wrong_answer_text": "曲调",
            "note": "避免字典把“pitch”误命中到 曲调",
        },
        {
            "source_text": "新闻",
            "answer_text": "news",
            "wrong_answer_text": "information",
            "note": "避免字典把“新闻”误命中到 information",
        },
        {
            "source_text": "抑制",
            "answer_text": "check",
            "wrong_answer_text": "block",
            "note": "避免字典把“抑制”误命中到 block",
        },
    ]
)


def env_flag(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() not in ("0", "false", "no", "off")


def maybe_open_target_site() -> None:
    if not env_flag("HDU_SNAP_AUTO_OPEN_SITE", default=True):
        logger.info("auto-open target site disabled by HDU_SNAP_AUTO_OPEN_SITE")
        return

    target_url = os.getenv("HDU_SNAP_TARGET_URL", DEFAULT_TARGET_URL).strip() or DEFAULT_TARGET_URL
    try:
        opened = open_url_in_browser(target_url)
        if opened:
            logger.info("opened target site in Chrome: %s", target_url)
        else:
            logger.warning("Chrome did not confirm opening; please open manually in Chrome: %s", target_url)
    except Exception as exc:
        logger.warning("failed to open target site automatically: %s", exc)
        logger.info("manual target URLs: %s", " | ".join(FALLBACK_TARGET_URLS))

    logger.info("extension will keep listening automatically after login; no terminal confirmation is required")
    logger.info("correct flow: open in Chrome -> login -> manually enter the question page -> backend answers automatically -> submit manually at the end")


def open_url_in_browser(url: str) -> bool:
    system_name = platform.system()

    if system_name == "Darwin":
        chrome_apps = ["Google Chrome", "Google Chrome.app", "Chrome"]
        for app_name in chrome_apps:
            result = subprocess.run(
                ["open", "-a", app_name, url],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
            )
            if result.returncode == 0:
                return True
        result = subprocess.run(
            ["open", url],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        return result.returncode == 0

    if system_name == "Windows":
        chrome_candidates = [
            shutil.which("chrome"),
            shutil.which("chrome.exe"),
            str(Path(os.getenv("ProgramFiles", "")) / "Google/Chrome/Application/chrome.exe"),
            str(Path(os.getenv("ProgramFiles(x86)", "")) / "Google/Chrome/Application/chrome.exe"),
            str(Path(os.getenv("LocalAppData", "")) / "Google/Chrome/Application/chrome.exe"),
        ]
        for candidate in chrome_candidates:
            if not candidate:
                continue
            candidate_path = Path(candidate)
            if candidate_path.exists() or shutil.which(candidate):
                try:
                    subprocess.Popen([str(candidate_path if candidate_path.exists() else candidate), url])
                    return True
                except Exception:
                    continue
        try:
            os.startfile(url)  # type: ignore[attr-defined]
            return True
        except Exception:
            return False

    linux_browsers = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]
    for browser_name in linux_browsers:
        browser_path = shutil.which(browser_name)
        if not browser_path:
            continue
        result = subprocess.run(
            [browser_path, url],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        if result.returncode == 0:
            return True

    result = subprocess.run(
        ["xdg-open", url],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    return result.returncode == 0


def prompt_runtime_mode() -> None:
    configured_mode = os.getenv("HDU_SNAP_MODE", "").strip()
    if configured_mode in ("0", "debug"):
        runtime_config.mode = "debug"
        logger.info("runtime mode selected from HDU_SNAP_MODE: debug")
        return
    if configured_mode in ("1", "normal"):
        runtime_config.mode = "normal"
        logger.info("runtime mode selected from HDU_SNAP_MODE: normal")
        return

    if not sys.stdin or not sys.stdin.isatty():
        runtime_config.mode = "normal"
        logger.info("stdin is not interactive, defaulting runtime mode to normal")
        return

    while True:
        print("请选择运行模式：")
        print("0. 调试模式")
        print("1. 正常模式")
        selected = input("请输入 1 或 0：").strip()
        if selected == "1":
            runtime_config.mode = "normal"
            break
        if selected == "0":
            runtime_config.mode = "debug"
            break
        print("输入无效，请重新输入。")

    logger.info("runtime mode selected: %s", runtime_config.mode)
    if runtime_config.is_debug:
        logger.info("debug mode enabled: recent10000 -> %s", DEBUG_RECENT_10000_PATH)
        logger.info("debug mode enabled: error1000 -> %s", DEBUG_ERROR_1000_PATH)


class DictionaryEngine:
    def __init__(self, db_path: Path, cache_path: Path) -> None:
        self.db_path = db_path
        self.cache_path = cache_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize_database()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _initialize_database(self) -> None:
        with self._connect() as conn:
            conn.executescript(
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

                CREATE INDEX IF NOT EXISTS idx_dictionary_word
                ON dictionary_entries(normalized_word);

                CREATE TABLE IF NOT EXISTS dictionary_aliases (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    normalized_gloss TEXT NOT NULL,
                    word TEXT NOT NULL,
                    normalized_word TEXT NOT NULL,
                    translation TEXT NOT NULL,
                    source TEXT NOT NULL,
                    UNIQUE(normalized_gloss, normalized_word, source)
                );

                CREATE INDEX IF NOT EXISTS idx_dictionary_alias_gloss
                ON dictionary_aliases(normalized_gloss);
                """
            )

        self._load_cache_file()

    def _load_cache_file(self) -> None:
        if not self.cache_path.exists():
            raise FileNotFoundError(f"未找到词库缓存文件：{self.cache_path}")

        payload = json.loads(self.cache_path.read_text(encoding="utf-8"))
        entries = payload.get("entries", [])
        records: List[Tuple[str, str, str, str, str]] = []
        alias_records: List[Tuple[str, str, str, str, str]] = []
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

            translation_candidates: List[str] = []
            if raw_meaning:
                translation_candidates.append(raw_meaning)
            if chinese_terms:
                translation_candidates.append("；".join(chinese_terms))

            for translation in translation_candidates:
                records.append(
                    (
                        word,
                        normalized_word,
                        translation,
                        normalize_chinese_gloss(translation),
                        source_name,
                    )
                )

            alias_values = set(chinese_terms)
            if raw_meaning:
                alias_values.add(normalize_chinese_gloss(raw_meaning))
                alias_values.update(split_glosses(raw_meaning))

            for alias in alias_values:
                if alias:
                    alias_records.append(
                        (
                            alias,
                            word,
                            normalized_word,
                            raw_meaning or "；".join(chinese_terms),
                            source_name,
                        )
                    )

        with self._connect() as conn:
            conn.executemany(
                """
                INSERT OR IGNORE INTO dictionary_entries
                    (word, normalized_word, translation, normalized_translation, source)
                VALUES (?, ?, ?, ?, ?)
                """,
                records,
            )
            conn.executemany(
                """
                INSERT OR IGNORE INTO dictionary_aliases
                    (normalized_gloss, word, normalized_word, translation, source)
                VALUES (?, ?, ?, ?, ?)
                """,
                alias_records,
            )
            conn.commit()

        logger.info(
            "dictionary ready from cache file: %s entries loaded into %s",
            len(entries),
            self.db_path,
        )

    def lookup_exact(self, source_text: str, options: Dict[str, str]) -> DictionaryLookupResult:
        normalized_source = normalize_text(source_text)
        if not normalized_source:
            return DictionaryLookupResult()

        if contains_chinese(source_text):
            candidate_map = {letter: normalize_text(text) for letter, text in options.items()}
            with self._connect() as conn:
                rows = conn.execute(
                    """
                    SELECT word, translation, source
                    FROM dictionary_aliases
                    WHERE normalized_gloss = ?
                    """,
                    (normalized_source,),
                ).fetchall()

            matched_letters = set()
            unique_hit: Optional[Tuple[str, sqlite3.Row]] = None
            for row in rows:
                normalized_word = normalize_text(row["word"])
                for letter, option_text in candidate_map.items():
                    if option_text == normalized_word:
                        matched_letters.add(letter)
                        if unique_hit is None:
                            unique_hit = (letter, row)

            if len(matched_letters) >= 2:
                return DictionaryLookupResult(
                    force_tier3=True,
                    force_reason=f"Tier1冲突: 命中多个候选项 {','.join(sorted(matched_letters))}",
                )
            if len(matched_letters) == 1 and unique_hit is not None:
                letter, row = unique_hit
                return DictionaryLookupResult(
                    decision=TierDecision(
                        target=letter,
                        method="字典匹配",
                        confidence=1.0,
                        detail=f"{source_text} -> {row['word']} ({row['source']})",
                    )
                )
            return DictionaryLookupResult()

        candidate_map = {letter: normalize_chinese_gloss(text) for letter, text in options.items()}
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT translation, normalized_translation, source
                FROM dictionary_entries
                WHERE normalized_word = ?
                """,
                (normalized_source,),
            ).fetchall()

        matched_letters = set()
        unique_hit: Optional[Tuple[str, sqlite3.Row, str]] = None
        for row in rows:
            translation = row["translation"]
            normalized_translation = row["normalized_translation"]
            translation_aliases = {normalized_translation, *split_glosses(translation)}
            for letter, option_text in candidate_map.items():
                if option_text in translation_aliases:
                    matched_letters.add(letter)
                    if unique_hit is None:
                        unique_hit = (letter, row, translation)

        if len(matched_letters) >= 2:
            return DictionaryLookupResult(
                force_tier3=True,
                force_reason=f"Tier1冲突: 命中多个候选项 {','.join(sorted(matched_letters))}",
            )
        if len(matched_letters) == 1 and unique_hit is not None:
            letter, row, translation = unique_hit
            return DictionaryLookupResult(
                decision=TierDecision(
                    target=letter,
                    method="字典匹配",
                    confidence=1.0,
                    detail=f"{source_text} -> {translation} ({row['source']})",
                )
            )

        return DictionaryLookupResult()

    def fetch_translations(self, source_text: str) -> List[str]:
        normalized_source = normalize_text(source_text)
        if not normalized_source:
            return []

        with self._connect() as conn:
            if contains_chinese(source_text):
                rows = conn.execute(
                    """
                    SELECT DISTINCT word
                    FROM dictionary_aliases
                    WHERE normalized_gloss = ?
                    ORDER BY id ASC
                    """,
                    (normalized_source,),
                ).fetchall()
                return [str(row["word"]) for row in rows]

            rows = conn.execute(
                """
                SELECT DISTINCT translation
                FROM dictionary_entries
                WHERE normalized_word = ?
                ORDER BY id ASC
                """,
                (normalized_source,),
            ).fetchall()
            return [str(row["translation"]) for row in rows]


class VectorEngine:
    def __init__(self, model_name: str = DEFAULT_EMBEDDING_MODEL, model_dir: Path = DEFAULT_EMBEDDING_MODEL_DIR) -> None:
        self.model_name = model_name
        self.model_dir = model_dir
        self.mode = "fallback"
        self.status_detail = "using built-in sparse similarity fallback"
        self.model = self._load_model()

    def _load_model(self) -> Optional[Any]:
        if SentenceTransformer is None:
            logger.warning("sentence-transformers is not installed, vector tier will use fallback scorer")
            self.mode = "fallback"
            self.status_detail = "sentence-transformers not installed"
            return None

        configured_dir = os.getenv("HDU_SNAP_EMBEDDING_MODEL_DIR", "").strip()
        candidate_dir = Path(configured_dir).expanduser() if configured_dir else self.model_dir
        if not candidate_dir.exists():
            logger.warning("vector model directory not found, fallback scorer enabled: %s", candidate_dir)
            self.mode = "fallback"
            self.status_detail = f"model directory missing: {candidate_dir}"
            return None

        try:
            model = SentenceTransformer(str(candidate_dir), local_files_only=True)
            self.mode = "embedding"
            self.status_detail = f"loaded local embedding model from {candidate_dir}"
            logger.info("vector embedding model active: %s", candidate_dir)
            return model
        except Exception as exc:  # pragma: no cover - depends on local model/runtime
            logger.warning(
                "embedding model unavailable locally, fallback scorer enabled: %s",
                exc,
            )
            self.mode = "fallback"
            self.status_detail = f"failed to load local model: {exc}"
            return None

    def rank(self, source_text: str, options: Dict[str, str], dictionary_hints: List[str]) -> List[VectorScore]:
        reference_text = "；".join(dictionary_hints) if dictionary_hints else source_text
        if self.model is not None:
            texts = [reference_text, *[options[letter] for letter in LETTER_ORDER]]
            embeddings = self.model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
            source_embedding = list(map(float, embeddings[0]))
            ranked: List[VectorScore] = []
            for index, letter in enumerate(LETTER_ORDER, start=1):
                option_embedding = list(map(float, embeddings[index]))
                ranked.append(
                    VectorScore(
                        letter=letter,
                        text=options[letter],
                        score=cosine_similarity(source_embedding, option_embedding),
                    )
                )
            return sorted(ranked, key=lambda item: item.score, reverse=True)

        source_vector = char_ngram_vector(reference_text)
        ranked = [
            VectorScore(
                letter=letter,
                text=option_text,
                score=sparse_cosine_similarity(source_vector, char_ngram_vector(option_text)),
            )
            for letter, option_text in options.items()
        ]
        return sorted(ranked, key=lambda item: item.score, reverse=True)

    def choose(
        self,
        source_text: str,
        options: Dict[str, str],
        dictionary_hints: List[str],
    ) -> Tuple[Optional[TierDecision], List[VectorScore]]:
        ranked = self.rank(source_text, options, dictionary_hints)
        if not ranked:
            return None, []

        best = ranked[0]
        second = ranked[1] if len(ranked) > 1 else VectorScore(letter="?", text="", score=0.0)
        margin = best.score - second.score
        if best.score >= VECTOR_TOP_SCORE_THRESHOLD and margin >= VECTOR_MARGIN_THRESHOLD:
            return (
                TierDecision(
                    target=best.letter,
                    method="向量相似度",
                    confidence=round(best.score, 4),
                    detail=f"top={best.score:.4f}, second={second.score:.4f}, margin={margin:.4f}",
                ),
                ranked,
            )

        return None, ranked


class LLMEngine:
    def __init__(
        self,
        api_key: Optional[str],
        base_url: str = DEEPSEEK_BASE_URL,
        model: str = DEEPSEEK_MODEL,
        timeout_seconds: float = 12.0,
        max_retries: int = 2,
    ) -> None:
        self.api_key = api_key
        self.base_url = base_url
        self.model = model
        self.timeout_seconds = timeout_seconds
        self.max_retries = max_retries
        self.client = self._build_client()

    def _build_client(self) -> Optional[Any]:
        if not self.api_key:
            logger.warning("DEEPSEEK_API_KEY is not configured, llm tier will use deterministic fallback")
            return None
        if AsyncOpenAI is None:
            logger.warning("openai package is not installed, llm tier will use deterministic fallback")
            return None
        return AsyncOpenAI(api_key=self.api_key, base_url=self.base_url, timeout=self.timeout_seconds)

    async def choose(
        self,
        source_text: str,
        options: Dict[str, str],
        vector_ranked: List[VectorScore],
        stats: RunStats,
    ) -> TierDecision:
        stats.record_ai_call()

        if self.client is None:
            best = vector_ranked[0]
            second_score = vector_ranked[1].score if len(vector_ranked) > 1 else 0.0
            return TierDecision(
                target=best.letter,
                method="大模型决策",
                confidence=round(best.score, 4),
                detail=(
                    "LLM unavailable, fallback to deterministic top-1 candidate "
                    f"(top={best.score:.4f}, second={second_score:.4f})"
                ),
            )

        option_lines = "\n".join(f"{letter}. {options[letter]}" for letter in LETTER_ORDER)
        prompt = (
            "你是英文词汇学习题的判题助手。\n"
            f"源文本: {source_text}\n"
            f"候选项:\n{option_lines}\n\n"
            "请从 A/B/C/D 中选择最贴切的翻译项。\n"
            "只输出一个大写字母，不要解释。"
        )

        last_error: Optional[Exception] = None
        for attempt in range(1, self.max_retries + 2):
            try:
                completion = await self.client.chat.completions.create(
                    model=self.model,
                    temperature=0,
                    max_tokens=4,
                    messages=[
                        {
                            "role": "system",
                            "content": "你是严格的英语翻译选择题助手，只输出 A/B/C/D 单个字母。",
                        },
                        {"role": "user", "content": prompt},
                    ],
                )
                content = completion.choices[0].message.content or ""
                match = re.search(r"[ABCD]", content.upper())
                if not match:
                    raise ValueError(f"invalid LLM response: {content!r}")
                return TierDecision(
                    target=match.group(0),
                    method="大模型决策",
                    detail=f"attempt={attempt}, raw={content.strip()}",
                )
            except Exception as exc:  # pragma: no cover - network/runtime dependent
                last_error = exc
                logger.warning("llm request failed (attempt %s): %s", attempt, exc)
                await asyncio.sleep(0.6 * attempt)

        best = vector_ranked[0]
        second_score = vector_ranked[1].score if len(vector_ranked) > 1 else 0.0
        return TierDecision(
            target=best.letter,
            method="大模型决策",
            confidence=round(best.score, 4),
            detail=(
                "LLM retries exhausted, fallback to deterministic top-1 candidate "
                f"(top={best.score:.4f}, second={second_score:.4f}, error={last_error})"
            ),
        )


class NLPPipeline:
    def __init__(
        self,
        dictionary_engine: DictionaryEngine,
        vector_engine: VectorEngine,
        llm_engine: LLMEngine,
        stats: RunStats,
        patch_store: PatchRuleStore,
    ) -> None:
        self.dictionary_engine = dictionary_engine
        self.vector_engine = vector_engine
        self.llm_engine = llm_engine
        self.stats = stats
        self.patch_store = patch_store
        self.session_records: List[Dict[str, Any]] = []

    def _lookup_patch_override(self, source_text: str, options: Dict[str, str]) -> Optional[TierDecision]:
        normalized_source = normalize_text(clean_source_text(source_text))
        if not normalized_source:
            return None

        for rule in self.patch_store.get_rules():
            rule_source = normalize_text(clean_source_text(str(rule.get("source_text", ""))))
            if rule_source != normalized_source:
                continue

            answer_text = str(rule.get("answer_text", "")).strip()
            normalized_answer = normalize_text(clean_option_text(answer_text))
            if not normalized_answer:
                continue

            for letter in LETTER_ORDER:
                option_text = options.get(letter, "")
                if normalize_text(clean_option_text(option_text)) == normalized_answer:
                    note = str(rule.get("note", "")).strip()
                    detail = f"{source_text} -> {option_text} (patch override)"
                    if note:
                        detail = f"{detail}; {note}"
                    return TierDecision(
                        target=letter,
                        method="补丁规则",
                        confidence=1.0,
                        detail=detail,
                    )
        return None

    async def solve(self, item_id: int, source_text: str, options: Dict[str, str], session_id: Optional[str] = None) -> TierDecision:
        patch_decision = self._lookup_patch_override(source_text, options)
        if patch_decision is not None:
            self._print_validation_log(item_id, source_text, options, patch_decision)
            self._record_debug_log(item_id, source_text, options, patch_decision, session_id=session_id)
            self.stats.record_item()
            return patch_decision

        dictionary_result = self.dictionary_engine.lookup_exact(source_text, options)
        if dictionary_result.decision is not None:
            self._print_validation_log(item_id, source_text, options, dictionary_result.decision)
            self._record_debug_log(item_id, source_text, options, dictionary_result.decision, session_id=session_id)
            self.stats.record_item()
            return dictionary_result.decision

        if dictionary_result.force_tier3:
            vector_ranked = self.vector_engine.rank(source_text, options, [])
            llm_decision = await self.llm_engine.choose(source_text, options, vector_ranked, self.stats)
            if dictionary_result.force_reason:
                llm_detail = llm_decision.detail or ""
                llm_decision.detail = f"{dictionary_result.force_reason}; {llm_detail}".strip("; ")
            self._print_validation_log(item_id, source_text, options, llm_decision)
            self._record_debug_log(item_id, source_text, options, llm_decision, session_id=session_id)
            self.stats.record_item()
            return llm_decision

        dictionary_hints = self.dictionary_engine.fetch_translations(source_text)
        vector_decision, vector_ranked = self.vector_engine.choose(source_text, options, dictionary_hints)
        if vector_decision is not None:
            self._print_validation_log(item_id, source_text, options, vector_decision)
            self._record_debug_log(item_id, source_text, options, vector_decision, session_id=session_id)
            self.stats.record_item()
            return vector_decision

        llm_decision = await self.llm_engine.choose(source_text, options, vector_ranked, self.stats)
        self._print_validation_log(item_id, source_text, options, llm_decision)
        self._record_debug_log(item_id, source_text, options, llm_decision, session_id=session_id)
        self.stats.record_item()
        return llm_decision

    def _print_validation_log(self, item_id: int, source_text: str, options: Dict[str, str], decision: TierDecision) -> None:
        option_line = " | ".join(f"{letter}. {options[letter]}" for letter in LETTER_ORDER)
        print("[节点校验日志]")
        print(f"第{item_id}题: {source_text}")
        print(f"候选项: {option_line}")
        print(f"处理方式: {decision.method}")
        print(f"决策结果: {decision.target}")
        print("------------------------")

    def print_final_summary(self, total_items: int) -> None:
        print("========================")
        print("[自动化测试运行结束]")
        print(f"总计处理测试项: {total_items} 个")
        print(f"触发大模型 (Tier 3) 决策总次数: {self.stats.ai_call_count} 次")
        print("状态: 挂起，等待人工确认表单...")
        print("========================")

    def _record_debug_log(
        self,
        item_id: int,
        source_text: str,
        options: Dict[str, str],
        decision: TierDecision,
        session_id: Optional[str] = None,
    ) -> None:
        if not runtime_config.is_debug:
            return

        record = {
            "timestamp": int(time.time()),
            "session_id": session_id,
            "item_id": item_id,
            "source_text": source_text,
            "options": {letter: options[letter] for letter in LETTER_ORDER},
            "target": decision.target,
            "method": decision.method,
            "detail": decision.detail,
        }
        self.session_records.append(record)
        debug_store.append_recent(record)

    async def collect_debug_feedback(self) -> None:
        if not runtime_config.is_debug:
            return
        if not self.session_records:
            return
        if not sys.stdin or not sys.stdin.isatty():
            logger.info("debug mode feedback skipped because stdin is not interactive")
            return

        prompt = (
            "调试模式：请输入本轮答错题的“题号:正确选项字母”，多个用空格或逗号分隔；"
            "例如 12:B 45:D。"
            "如果只输题号，系统会继续逐题询问正确选项。"
            "如果没有错题，直接按回车："
        )
        raw = await asyncio.to_thread(input, prompt)
        raw = raw.strip()
        if not raw:
            logger.info("debug mode: no wrong answers provided")
            return

        answer_map: Dict[int, str] = {}
        pending_ids: List[int] = []
        for token in re.split(r"[\s,，]+", raw):
            if not token:
                continue
            match = re.fullmatch(r"(\d+)(?:\s*[:=：>\-]\s*([ABCDabcd]))?", token)
            if not match:
                continue
            item_id = int(match.group(1))
            correct_target = (match.group(2) or "").upper()
            if correct_target in LETTER_ORDER:
                answer_map[item_id] = correct_target
            else:
                pending_ids.append(item_id)

        if not answer_map and not pending_ids:
            logger.warning("debug mode: no valid wrong-answer payload parsed from input: %s", raw)
            return

        session_record_map = {record["item_id"]: record for record in self.session_records}
        for item_id in pending_ids:
            record = session_record_map.get(item_id)
            if record is None:
                continue
            follow_up = (
                f"第{item_id}题正确选项是哪个字母？"
                f" 当前系统选择={record['target']}，候选项={record['options']}："
            )
            correct_target = (await asyncio.to_thread(input, follow_up)).strip().upper()
            if correct_target in LETTER_ORDER:
                answer_map[item_id] = correct_target

        if not answer_map:
            logger.warning("debug mode: no correct targets collected")
            return

        matched = []
        for item_id, correct_target in answer_map.items():
            record = session_record_map.get(item_id)
            if record is None:
                continue
            wrong_target = record["target"]
            enriched_record = dict(record)
            enriched_record["wrong_target"] = wrong_target
            enriched_record["wrong_option_text"] = record["options"].get(wrong_target, "")
            enriched_record["correct_target"] = correct_target
            enriched_record["correct_option_text"] = record["options"].get(correct_target, "")
            matched.append(enriched_record)

        if not matched:
            logger.warning("debug mode: none of the provided question numbers matched current session logs")
            return

        debug_store.append_errors(matched)
        patch_count = 0
        for record in matched:
            self.patch_store.upsert_rule(
                source_text=record["source_text"],
                answer_text=record["correct_option_text"],
                wrong_answer_text=record["wrong_option_text"],
                note=(
                    f"调试模式自动补丁: 第{record['item_id']}题, "
                    f"原方法={record['method']}, "
                    f"错选={record['wrong_target']}->{record['wrong_option_text']}, "
                    f"正选={record['correct_target']}->{record['correct_option_text']}"
                ),
            )
            patch_count += 1
        logger.info(
            "debug mode logs updated: recent10000=%s, error1000=%s, latest matched errors=%s, patches=%s",
            len(debug_store.recent_questions),
            len(debug_store.error_questions),
            len(matched),
            patch_count,
        )
        logger.info("recent question log file: %s", DEBUG_RECENT_10000_PATH)
        logger.info("recent error log file: %s", DEBUG_ERROR_1000_PATH)
        logger.info("patch rule file: %s", PATCH_RULES_PATH)

    def ingest_review_results(self, errors: List[ReviewResultItemPayload], session_id: Optional[str] = None) -> Dict[str, int]:
        if not errors:
            return {"errors": 0, "patches": 0}

        record_index = {}
        for record in self.session_records:
            record_session_id = record.get("session_id")
            record_key = (record_session_id, record["item_id"])
            record_index[record_key] = record
        for record in debug_store.recent_questions:
            record_session_id = record.get("session_id")
            record_key = (record_session_id, record["item_id"])
            record_index[record_key] = record

        matched = []
        for error in errors:
            original_record = record_index.get((session_id, error.item_id)) or record_index.get((None, error.item_id))
            original_method = original_record.get("method") if original_record else None
            matched.append(
                {
                    "timestamp": int(time.time()),
                    "session_id": session_id,
                    "item_id": error.item_id,
                    "source_text": error.source_text,
                    "options": {letter: error.options[letter] for letter in LETTER_ORDER},
                    "target": error.wrong_target,
                    "method": original_method or error.method or "未知方法",
                    "detail": (
                        f"结果页自动采集: 错选={error.wrong_target}->{error.wrong_option_text}, "
                        f"正选={error.correct_target}->{error.correct_option_text}"
                    ),
                    "wrong_target": error.wrong_target,
                    "wrong_option_text": error.wrong_option_text,
                    "correct_target": error.correct_target,
                    "correct_option_text": error.correct_option_text,
                }
            )

        debug_store.append_errors(matched)
        patch_count = 0
        for record in matched:
            self.patch_store.upsert_rule(
                source_text=record["source_text"],
                answer_text=record["correct_option_text"],
                wrong_answer_text=record["wrong_option_text"],
                note=(
                    f"结果页自动补丁: 第{record['item_id']}题, "
                    f"错选={record['wrong_target']}->{record['wrong_option_text']}, "
                    f"正选={record['correct_target']}->{record['correct_option_text']}"
                ),
            )
            patch_count += 1

        logger.info(
            "review results ingested: errors=%s, patches=%s, error_log=%s, patch_file=%s",
            len(matched),
            patch_count,
            DEBUG_ERROR_1000_PATH,
            PATCH_RULES_PATH,
        )
        return {"errors": len(matched), "patches": patch_count}


class ServiceContainer:
    def __init__(self) -> None:
        self.dictionary_engine = DictionaryEngine(
            db_path=DEFAULT_DB_PATH,
            cache_path=REFERENCE_WORD_CACHE_PATH,
        )
        self.vector_engine = VectorEngine()
        self.llm_engine = LLMEngine(api_key=os.getenv("DEEPSEEK_API_KEY"))
        self.patch_store = patch_rule_store

    def build_pipeline(self) -> NLPPipeline:
        return NLPPipeline(
            dictionary_engine=self.dictionary_engine,
            vector_engine=self.vector_engine,
            llm_engine=self.llm_engine,
            stats=RunStats(),
            patch_store=self.patch_store,
        )


services = ServiceContainer()


@app.get("/health")
async def healthcheck() -> Dict[str, Any]:
    return {
        "status": "ok",
        "runtime_mode": runtime_config.mode,
        "dictionary_source": str(REFERENCE_WORD_CACHE_PATH),
        "patch_rule_file": str(PATCH_RULES_PATH),
        "patch_rule_count": len(services.patch_store.get_rules()),
        "vector_mode": services.vector_engine.mode,
        "vector_status_detail": services.vector_engine.status_detail,
        "vector_model_dir": str(services.vector_engine.model_dir),
        "timestamp": int(time.time()),
    }


async def send_json(websocket: WebSocket, payload: Union[BaseModel, Dict[str, Any]]) -> None:
    if isinstance(payload, BaseModel):
        serializer = getattr(payload, "model_dump", None)
        await websocket.send_json(serializer() if serializer else payload.dict())
        return
    await websocket.send_json(payload)


def parse_client_message(payload: Dict[str, Any]) -> Union[SolveItemPayload, BatchCompletePayload, ReviewResultsPayload]:
    message_type = payload.get("type", "solve_item")
    if message_type == "batch_complete":
        normalized_payload = {
            "type": message_type,
            "session_id": payload.get("session_id"),
            "total_items": payload.get("total_items", 100),
        }
        validator = getattr(BatchCompletePayload, "model_validate", None)
        return validator(normalized_payload) if validator else BatchCompletePayload.parse_obj(normalized_payload)

    if message_type == "review_results":
        raw_errors = payload.get("errors")
        if not isinstance(raw_errors, list):
            raise ValueError("errors must be an array")

        normalized_errors = []
        for raw_error in raw_errors:
            if not isinstance(raw_error, dict):
                raise ValueError("each review error must be an object")

            raw_options = raw_error.get("options")
            if not isinstance(raw_options, dict):
                raise ValueError("review error options must be an object")

            normalized_options: Dict[str, str] = {}
            for letter in LETTER_ORDER:
                if letter not in raw_options:
                    raise ValueError(f"missing review option '{letter}'")
                option_text = clean_option_text(str(raw_options[letter]))
                if not option_text:
                    raise ValueError(f"review option '{letter}' cannot be empty")
                normalized_options[letter] = option_text

            wrong_target = str(raw_error.get("wrong_target", "")).upper()
            correct_target = str(raw_error.get("correct_target", "")).upper()
            if wrong_target not in LETTER_ORDER or correct_target not in LETTER_ORDER:
                raise ValueError("wrong_target and correct_target must be one of A/B/C/D")

            source_text = clean_source_text(str(raw_error.get("source_text", "")))
            wrong_option_text = clean_option_text(str(raw_error.get("wrong_option_text", "")))
            correct_option_text = clean_option_text(str(raw_error.get("correct_option_text", "")))
            if not source_text or not wrong_option_text or not correct_option_text:
                raise ValueError("review source_text and option texts cannot be empty")

            normalized_errors.append(
                {
                    "item_id": int(raw_error.get("item_id")),
                    "source_text": source_text,
                    "options": normalized_options,
                    "wrong_target": wrong_target,
                    "correct_target": correct_target,
                    "wrong_option_text": wrong_option_text,
                    "correct_option_text": correct_option_text,
                    "method": str(raw_error.get("method", "")).strip() or None,
                }
            )

        normalized_payload = {
            "type": message_type,
            "session_id": payload.get("session_id"),
            "errors": normalized_errors,
        }
        validator = getattr(ReviewResultsPayload, "model_validate", None)
        return validator(normalized_payload) if validator else ReviewResultsPayload.parse_obj(normalized_payload)

    options = payload.get("options")
    if not isinstance(options, dict):
        raise ValueError("options must be an object containing A/B/C/D")

    normalized_options: Dict[str, str] = {}
    for letter in LETTER_ORDER:
        if letter not in options:
            raise ValueError(f"missing option '{letter}'")
        option_text = clean_option_text(str(options[letter]))
        if not option_text:
            raise ValueError(f"option '{letter}' cannot be empty")
        normalized_options[letter] = option_text

    normalized_payload = {
        "type": message_type,
        "session_id": payload.get("session_id"),
        "item_id": payload.get("item_id"),
        "source_text": clean_source_text(str(payload.get("source_text", ""))),
        "options": normalized_options,
    }
    if not normalized_payload["source_text"]:
        raise ValueError("source_text cannot be empty")

    validator = getattr(SolveItemPayload, "model_validate", None)
    return validator(normalized_payload) if validator else SolveItemPayload.parse_obj(normalized_payload)


@app.websocket("/ws/solve")
async def solve_socket(websocket: WebSocket) -> None:
    await websocket.accept()
    logger.info("websocket connected: %s", websocket.client)
    pipeline = services.build_pipeline()

    try:
        while True:
            raw_message = await websocket.receive_text()
            try:
                payload = json.loads(raw_message)
                parsed_message = parse_client_message(payload)
            except Exception as exc:
                await send_json(websocket, ErrorResponse(message=f"invalid payload: {exc}"))
                continue

            if isinstance(parsed_message, BatchCompletePayload):
                pipeline.print_final_summary(pipeline.stats.processed_items or parsed_message.total_items)
                await send_json(
                    websocket,
                    {
                        "type": "batch_summary",
                        "session_id": parsed_message.session_id,
                        "total_items": pipeline.stats.processed_items or parsed_message.total_items,
                        "ai_call_count": pipeline.stats.ai_call_count,
                        "review_mode": runtime_config.is_debug,
                        "status": "pending_manual_confirmation",
                    },
                )
                continue

            if isinstance(parsed_message, ReviewResultsPayload):
                if runtime_config.is_debug:
                    review_stats = pipeline.ingest_review_results(parsed_message.errors, session_id=parsed_message.session_id)
                    await send_json(
                        websocket,
                        {
                            "type": "review_results_ack",
                            "session_id": parsed_message.session_id,
                            "status": "ok",
                            "error_count": review_stats["errors"],
                            "patch_count": review_stats["patches"],
                        },
                    )
                else:
                    await send_json(
                        websocket,
                        {
                            "type": "review_results_ack",
                            "session_id": parsed_message.session_id,
                            "status": "ignored",
                            "error_count": 0,
                            "patch_count": 0,
                        },
                    )
                continue

            try:
                decision = await pipeline.solve(
                    item_id=parsed_message.item_id,
                    source_text=parsed_message.source_text,
                    options=parsed_message.options,
                    session_id=parsed_message.session_id,
                )
                await send_json(
                    websocket,
                    DecisionResponse(
                        session_id=parsed_message.session_id,
                        item_id=parsed_message.item_id,
                        target=decision.target,
                        method=decision.method,
                        confidence=decision.confidence,
                        detail=decision.detail,
                    ),
                )
            except Exception as exc:  # pragma: no cover - safeguard for live websocket session
                logger.exception("failed to solve item %s", parsed_message.item_id)
                await send_json(
                    websocket,
                    ErrorResponse(
                        session_id=parsed_message.session_id,
                        item_id=parsed_message.item_id,
                        message=f"server error: {exc}",
                    ),
                )
    except WebSocketDisconnect:
        logger.info("websocket disconnected: %s", websocket.client)


if __name__ == "__main__":
    import uvicorn

    prompt_runtime_mode()
    maybe_open_target_site()
    uvicorn.run(app, host="127.0.0.1", port=8765, reload=False)
