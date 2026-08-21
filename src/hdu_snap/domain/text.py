from __future__ import annotations

import re


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
