#!/usr/bin/env python3
"""Render ChatGPT conversation JSON exports to readable txt files."""

import json
import sys
from datetime import datetime
from pathlib import Path


def timestamp_to_str(ts):
    if ts is None:
        return ""
    return datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M:%S")


def get_text_from_content(content):
    if not content:
        return ""
    ct = content.get("content_type", "")
    if ct in ("text", "multimodal_text"):
        parts = content.get("parts", [])
        return "\n".join(p for p in parts if isinstance(p, str) and p.strip())
    if ct == "code":
        lang = content.get("language", "")
        text = content.get("text", "")
        return f"```{lang}\n{text}\n```" if text.strip() else ""
    if ct == "tether_quote":
        title = content.get("title", "")
        text = content.get("text", "")
        url = content.get("url", "")
        parts = [f"> {title}" if title else ""]
        if url:
            parts.append(f"> Source: {url}")
        if text:
            parts.append(f"> {text}")
        return "\n".join(p for p in parts if p)
    return ""


def build_linear_chain(mapping):
    """Follow the main branch: root -> ... -> leaf, picking the last child at each step."""
    # Find root
    root_id = next(nid for nid, node in mapping.items() if node.get("parent") is None)
    chain = []
    current = root_id
    visited = set()
    while current and current not in visited:
        visited.add(current)
        chain.append(current)
        children = mapping[current].get("children", [])
        current = children[-1] if children else None
    return chain


def render_conversation(json_path: Path) -> str:
    data = json.loads(json_path.read_text(encoding="utf-8"))
    title = data.get("title", json_path.stem)
    create_time = timestamp_to_str(data.get("create_time"))
    update_time = timestamp_to_str(data.get("update_time"))
    mapping = data.get("mapping", {})

    lines = [
        f"{'=' * 60}",
        f"Title: {title}",
        f"Created: {create_time}  Updated: {update_time}",
        f"{'=' * 60}",
        "",
    ]

    chain = build_linear_chain(mapping)
    role_labels = {"user": "User", "assistant": "Assistant", "tool": "Tool", "system": "System"}

    for node_id in chain:
        node = mapping.get(node_id, {})
        msg = node.get("message")
        if not msg:
            continue

        # Skip hidden messages
        meta = msg.get("metadata") or {}
        if meta.get("is_visually_hidden_from_conversation"):
            continue

        role = msg.get("author", {}).get("role", "unknown")
        label = role_labels.get(role, role.capitalize())
        text = get_text_from_content(msg.get("content"))

        if not text.strip():
            continue

        ts = msg.get("create_time")
        ts_str = f"  [{timestamp_to_str(ts)}]" if ts else ""

        lines.append(f"[{label}]{ts_str}")
        lines.append(text)
        lines.append("")

    return "\n".join(lines)


def main():
    conv_dir = Path(__file__).parent / "conversations"
    out_dir = Path(__file__).parent / "output"
    out_dir.mkdir(exist_ok=True)

    json_files = sorted(conv_dir.glob("*.json"))
    if not json_files:
        print("No JSON files found in conversations/")
        sys.exit(1)

    for json_file in json_files:
        print(f"Processing: {json_file.name}")
        rendered = render_conversation(json_file)
        out_file = out_dir / (json_file.stem + ".txt")
        out_file.write_text(rendered, encoding="utf-8")
        print(f"  -> {out_file}")

    print(f"\nDone. {len(json_files)} file(s) rendered.")


if __name__ == "__main__":
    main()
