from __future__ import annotations

import re
from math import sqrt


def normalize_text(text: str) -> str:
    value = (text or "").strip().lower()
    value = re.sub(r"\s+", "", value)
    return re.sub(r"[，。；：,.!?！？()（）\[\]{}'\"“”‘’·\-_/\\]", "", value)


def clean_source_text(text: str) -> str:
    value = " ".join((text or "").split()).strip()
    value = re.sub(r"^QUESTION\s*\d+\s*", "", value, flags=re.IGNORECASE)
    value = re.sub(r"^第\s*\d+\s*题[：:.\-\s]*", "", value)
    value = re.sub(r"^CET\s*[- ]\s*\d+\s+", "", value, flags=re.IGNORECASE)
    value = re.sub(r"^(?:CET[- ]?[46])\s+", "", value, flags=re.IGNORECASE)
    value = re.sub(r"(自动下一题|题卡|上一题|下一题).*$", "", value, flags=re.IGNORECASE)
    return value.strip(" .。?？:：;；")


def clean_option_text(text: str) -> str:
    value = " ".join((text or "").split()).strip()
    value = re.sub(r"^[ABCDabcd][.\s:：、\)]\s*", "", value)
    return value.strip(" .。?？:：;；")


def contains_chinese(text: str) -> bool:
    return bool(re.search(r"[\u4e00-\u9fff]", text or ""))


def normalize_chinese_gloss(text: str) -> str:
    return normalize_text(text).replace("；", "，")


def split_glosses(text: str) -> list[str]:
    chunks = re.split(r"[，;,；/、]|(?:\s+-\s+)", text or "")
    cleaned = [normalize_chinese_gloss(chunk) for chunk in chunks if normalize_chinese_gloss(chunk)]
    return list(dict.fromkeys(cleaned))


def cosine_similarity(left: list[float], right: list[float]) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0
    dot = sum(x * y for x, y in zip(left, right))
    norm_left = sqrt(sum(value * value for value in left))
    norm_right = sqrt(sum(value * value for value in right))
    return dot / (norm_left * norm_right) if norm_left and norm_right else 0.0


def char_ngram_vector(text: str, n: int = 2) -> dict[str, int]:
    compact = normalize_chinese_gloss(text)
    if not compact:
        return {}
    if len(compact) < n:
        return {compact: 1}
    result: dict[str, int] = {}
    for index in range(len(compact) - n + 1):
        gram = compact[index : index + n]
        result[gram] = result.get(gram, 0) + 1
    return result


def sparse_cosine_similarity(left: dict[str, int], right: dict[str, int]) -> float:
    if not left or not right:
        return 0.0
    keys = set(left) | set(right)
    dot = sum(left.get(key, 0) * right.get(key, 0) for key in keys)
    norm_left = sqrt(sum(value * value for value in left.values()))
    norm_right = sqrt(sum(value * value for value in right.values()))
    return dot / (norm_left * norm_right) if norm_left and norm_right else 0.0
