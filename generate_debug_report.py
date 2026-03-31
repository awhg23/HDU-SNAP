#!/usr/bin/env python3

import json
import math
import re
from collections import Counter
from pathlib import Path
from statistics import mean


ROOT = Path(__file__).resolve().parent
RUNTIME = ROOT / "runtime"
RECENT_PATH = RUNTIME / "debug_recent_500.json"
ERROR_PATH = RUNTIME / "debug_error_100.json"
HTML_PATH = RUNTIME / "debug_report.html"
SUMMARY_PATH = RUNTIME / "debug_report_summary.json"

METHODS = ("补丁规则", "字典匹配", "向量相似度", "大模型决策")
VECTOR_DETAIL_RE = re.compile(r"top=(\d+\.\d+), second=(\d+\.\d+), margin=(\d+\.\d+)")


def load_json(path: Path):
    if not path.exists():
        raise FileNotFoundError(f"Missing file: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def split_sessions(recent_rows):
    sessions = []
    current = []
    prev = None
    for row in recent_rows:
        if prev is not None and row["item_id"] <= prev["item_id"]:
            sessions.append(current)
            current = []
        current.append(row)
        prev = row
    if current:
        sessions.append(current)
    return sessions


def parse_vector_detail(row):
    detail = row.get("detail") or ""
    match = VECTOR_DETAIL_RE.search(detail)
    if not match:
        return None
    top, second, margin = map(float, match.groups())
    return {"top": top, "second": second, "margin": margin}


def count_by_method(rows):
    counter = Counter(("补丁规则" if row["method"] == "人工规则" else row["method"]) for row in rows)
    return {method: counter.get(method, 0) for method in METHODS}


def build_session_stats(sessions):
    result = []
    for index, rows in enumerate(sessions, start=1):
        result.append(
            {
                "session_index": index,
                "count": len(rows),
                "item_start": rows[0]["item_id"],
                "item_end": rows[-1]["item_id"],
                "ts_start": rows[0]["timestamp"],
                "ts_end": rows[-1]["timestamp"],
                "methods": count_by_method(rows),
            }
        )
    return result


def build_vector_stats(rows):
    parsed = []
    for row in rows:
        if row["method"] != "向量相似度":
            continue
        detail = parse_vector_detail(row)
        if detail:
            parsed.append(detail)

    if not parsed:
        return {
            "count": 0,
            "top_avg": None,
            "second_avg": None,
            "margin_avg": None,
            "margin_min": None,
            "margin_max": None,
        }

    return {
        "count": len(parsed),
        "top_avg": round(mean(item["top"] for item in parsed), 4),
        "second_avg": round(mean(item["second"] for item in parsed), 4),
        "margin_avg": round(mean(item["margin"] for item in parsed), 4),
        "margin_min": round(min(item["margin"] for item in parsed), 4),
        "margin_max": round(max(item["margin"] for item in parsed), 4),
        "margins": [round(item["margin"], 4) for item in parsed],
    }


def svg_bar_chart(title, data_map, width=520, height=240, color="#3563e9"):
    padding = 36
    chart_height = height - padding * 2
    chart_width = width - padding * 2
    labels = list(data_map.keys())
    values = list(data_map.values())
    max_value = max(values) if values else 1
    bar_width = chart_width / max(len(values), 1) * 0.6
    gap = chart_width / max(len(values), 1) * 0.4

    bars = []
    for index, value in enumerate(values):
        x = padding + index * (bar_width + gap) + gap / 2
        bar_h = 0 if max_value == 0 else chart_height * (value / max_value)
        y = padding + chart_height - bar_h
        bars.append(
            f'<rect x="{x:.1f}" y="{y:.1f}" width="{bar_width:.1f}" height="{bar_h:.1f}" rx="6" fill="{color}"></rect>'
            f'<text x="{x + bar_width / 2:.1f}" y="{y - 8:.1f}" text-anchor="middle" font-size="12" fill="#1f2937">{value}</text>'
            f'<text x="{x + bar_width / 2:.1f}" y="{height - 14:.1f}" text-anchor="middle" font-size="12" fill="#475569">{labels[index]}</text>'
        )

    return f"""
    <section class="card">
      <h2>{title}</h2>
      <svg viewBox="0 0 {width} {height}" width="100%" height="{height}">
        <line x1="{padding}" y1="{padding + chart_height}" x2="{width - padding}" y2="{padding + chart_height}" stroke="#cbd5e1" stroke-width="1" />
        {''.join(bars)}
      </svg>
    </section>
    """


def svg_line_chart(title, points, width=640, height=260):
    if not points:
        return f'<section class="card"><h2>{title}</h2><p>No data</p></section>'

    padding = 40
    chart_width = width - padding * 2
    chart_height = height - padding * 2
    xs = list(range(len(points)))
    ys = [point["count"] for point in points]
    max_y = max(ys) or 1

    path_points = []
    for index, value in enumerate(ys):
        x = padding + (chart_width * index / max(len(ys) - 1, 1))
        y = padding + chart_height - chart_height * (value / max_y)
        path_points.append((x, y))

    polyline = " ".join(f"{x:.1f},{y:.1f}" for x, y in path_points)
    circles = "".join(
        f'<circle cx="{x:.1f}" cy="{y:.1f}" r="4" fill="#ef4444"></circle>'
        f'<text x="{x:.1f}" y="{y - 10:.1f}" text-anchor="middle" font-size="11" fill="#1f2937">{points[i]["count"]}</text>'
        f'<text x="{x:.1f}" y="{height - 12:.1f}" text-anchor="middle" font-size="11" fill="#475569">S{points[i]["session_index"]}</text>'
        for i, (x, y) in enumerate(path_points)
    )

    return f"""
    <section class="card">
      <h2>{title}</h2>
      <svg viewBox="0 0 {width} {height}" width="100%" height="{height}">
        <line x1="{padding}" y1="{padding + chart_height}" x2="{width - padding}" y2="{padding + chart_height}" stroke="#cbd5e1" stroke-width="1" />
        <polyline fill="none" stroke="#ef4444" stroke-width="3" points="{polyline}" />
        {circles}
      </svg>
    </section>
    """


def render_error_table(errors):
    rows = []
    for row in errors:
        wrong_target = row.get("wrong_target") or row.get("target") or ""
        wrong_option_text = row.get("wrong_option_text") or row.get("options", {}).get(wrong_target, "")
        correct_target = row.get("correct_target") or ""
        correct_option_text = row.get("correct_option_text") or row.get("options", {}).get(correct_target, "")
        rows.append(
            "<tr>"
            f"<td>{row['item_id']}</td>"
            f"<td>{row['method']}</td>"
            f"<td>{row['source_text']}</td>"
            f"<td>{wrong_target}</td>"
            f"<td>{wrong_option_text}</td>"
            f"<td>{correct_target}</td>"
            f"<td>{correct_option_text}</td>"
            f"<td>{json.dumps(row['options'], ensure_ascii=False)}</td>"
            f"<td>{row.get('detail') or ''}</td>"
            "</tr>"
        )
    return """
    <section class="card wide">
      <h2>错题明细</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>题号</th><th>方法</th><th>题目</th><th>错选</th><th>错选文本</th><th>正选</th><th>正选文本</th><th>选项</th><th>细节</th></tr>
          </thead>
          <tbody>
            %s
          </tbody>
        </table>
      </div>
    </section>
    """ % "".join(rows)


def build_summary(recent, errors):
    sessions = split_sessions(recent)
    recent_methods = count_by_method(recent)
    error_methods = count_by_method(errors)
    session_stats = build_session_stats(sessions)
    vector_recent = build_vector_stats(recent)
    vector_error = build_vector_stats(errors)

    return {
        "recent_count": len(recent),
        "error_count": len(errors),
        "recent_methods": recent_methods,
        "error_methods": error_methods,
        "session_stats": session_stats,
        "session_error_points": build_session_error_points({"session_stats": session_stats}, errors),
        "vector_recent": vector_recent,
        "vector_error": vector_error,
    }


def build_session_error_points(summary, errors):
    points = []
    for session in summary["session_stats"]:
        count = sum(
            1
            for row in errors
            if session["ts_start"] <= row.get("timestamp", -1) <= session["ts_end"]
        )
        points.append({"session_index": session["session_index"], "count": count})
    return points


def write_report(summary, errors):
    session_error_points = summary.get("session_error_points") or build_session_error_points(summary, errors)
    margin_buckets = {
        "<0.06": sum(1 for m in summary["vector_recent"].get("margins", []) if m < 0.06),
        "<0.08": sum(1 for m in summary["vector_recent"].get("margins", []) if m < 0.08),
        "<0.10": sum(1 for m in summary["vector_recent"].get("margins", []) if m < 0.10),
        ">=0.10": sum(1 for m in summary["vector_recent"].get("margins", []) if m >= 0.10),
    }

    html = f"""
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>HDU-SNAP Debug Report</title>
  <style>
    body {{
      margin: 0;
      padding: 24px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f8fafc;
      color: #0f172a;
    }}
    h1 {{ margin: 0 0 8px; }}
    .meta {{ color: #475569; margin-bottom: 24px; }}
    .grid {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
      gap: 20px;
    }}
    .card {{
      background: white;
      border: 1px solid #e2e8f0;
      border-radius: 14px;
      padding: 18px;
      box-shadow: 0 8px 20px rgba(15, 23, 42, 0.05);
    }}
    .wide {{ margin-top: 20px; }}
    .stats {{
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
      margin-bottom: 20px;
    }}
    .stat {{
      background: white;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 14px 16px;
      min-width: 160px;
    }}
    .stat .label {{ font-size: 12px; color: #64748b; }}
    .stat .value {{ font-size: 24px; font-weight: 700; margin-top: 6px; }}
    table {{
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }}
    th, td {{
      border-bottom: 1px solid #e2e8f0;
      padding: 10px 8px;
      text-align: left;
      vertical-align: top;
    }}
    th {{ background: #f8fafc; }}
    .table-wrap {{
      overflow-x: auto;
    }}
    code {{
      background: #eff6ff;
      padding: 2px 6px;
      border-radius: 6px;
    }}
  </style>
</head>
<body>
  <h1>HDU-SNAP 调试报告</h1>
  <div class="meta">
    基于 <code>{RECENT_PATH.name}</code> 与 <code>{ERROR_PATH.name}</code> 自动生成
  </div>
  <div class="stats">
    <div class="stat"><div class="label">最近题目数</div><div class="value">{summary['recent_count']}</div></div>
    <div class="stat"><div class="label">录入错题数</div><div class="value">{summary['error_count']}</div></div>
    <div class="stat"><div class="label">最近轮次数</div><div class="value">{len(summary['session_stats'])}</div></div>
    <div class="stat"><div class="label">最近向量判题数</div><div class="value">{summary['vector_recent']['count']}</div></div>
  </div>
  <div class="grid">
    {svg_bar_chart("最近 500 题方法分布", summary["recent_methods"], color="#0f766e")}
    {svg_bar_chart("错题方法分布", summary["error_methods"], color="#dc2626")}
    {svg_line_chart("各轮错题数量", session_error_points)}
    {svg_bar_chart("最近向量 margin 关键区间", margin_buckets, color="#7c3aed")}
  </div>
  {render_error_table(errors)}
</body>
</html>
"""
    HTML_PATH.write_text(html, encoding="utf-8")


def main():
    recent = load_json(RECENT_PATH)
    errors = load_json(ERROR_PATH)
    summary = build_summary(recent, errors)
    SUMMARY_PATH.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    write_report(summary, errors)
    print(f"Summary written to: {SUMMARY_PATH}")
    print(f"HTML report written to: {HTML_PATH}")


if __name__ == "__main__":
    main()
