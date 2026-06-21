#!/usr/bin/env python3
"""Share URL and Base64URL helpers for schemzip payloads."""

from __future__ import annotations

import base64
import gzip
import json
import re
from typing import Any, Dict, Mapping, MutableMapping, Optional
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


COMPACT_FRAGMENT_RE = re.compile(r"^(?P<lib>[^@:#?]+)@(?P<ver>[^:#?]+):(?P<data>[^#?]+)$")


def encode_base64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def decode_base64url(token: str) -> bytes:
    padding = "=" * (-len(token) % 4)
    return base64.urlsafe_b64decode((token + padding).encode("ascii"))


def encode_payload_json(payload: Mapping[str, Any]) -> str:
    raw = json.dumps(payload, ensure_ascii=True, sort_keys=False, separators=(",", ":")).encode("utf-8")
    compressed = gzip.compress(raw, compresslevel=9, mtime=0)
    return encode_base64url(compressed)


def decode_payload_json(token: str) -> Dict[str, Any]:
    compressed = decode_base64url(token)
    raw = gzip.decompress(compressed)
    return json.loads(raw.decode("utf-8"))


def build_share_params(
    archive: Mapping[str, Any],
    *,
    library_id: str,
    library_version: str,
    library_sha: str,
    schema_version: int = 1,
) -> Dict[str, str]:
    return {
        "v": str(schema_version),
        "lib": library_id,
        "ver": library_version,
        "sha": library_sha,
        "data": encode_payload_json(archive),
    }


def build_share_url(base_url: str, params: Mapping[str, str]) -> str:
    normalized = base_url
    if "#" in normalized:
        normalized = normalized.split("#", 1)[0]
    parts = urlsplit(normalized)
    fragment = urlencode(list(params.items()))
    return urlunsplit((parts.scheme, parts.netloc, parts.path, parts.query, fragment))


def build_share_fragment(params: Mapping[str, str]) -> str:
    return urlencode(list(params.items()))


def parse_share_fragment(fragment: str) -> Dict[str, str]:
    fragment = fragment.lstrip("#")
    if not fragment:
        raise ValueError("empty share fragment")
    if "=" in fragment:
        return {key: value for key, value in parse_qsl(fragment, keep_blank_values=True)}
    compact = COMPACT_FRAGMENT_RE.match(fragment)
    if not compact:
        raise ValueError("unsupported share fragment format")
    return {
        "v": "1",
        "lib": compact.group("lib"),
        "ver": compact.group("ver"),
        "data": compact.group("data"),
    }


def parse_share_url(source: str) -> Dict[str, str]:
    text = source.strip()
    if not text:
        raise ValueError("empty share url")
    if text.startswith("#"):
        return parse_share_fragment(text)
    parts = urlsplit(text)
    if parts.fragment:
        return parse_share_fragment(parts.fragment)
    if parts.query:
        return {key: value for key, value in parse_qsl(parts.query, keep_blank_values=True)}
    return parse_share_fragment(text)


def decode_share_payload(source: str) -> Dict[str, Any]:
    params = parse_share_url(source)
    data = params.get("data")
    if not data:
        raise ValueError("share url is missing data payload")
    archive = decode_payload_json(data)
    return {
        "params": params,
        "archive": archive,
    }
