#!/usr/bin/env python3
"""Regression tests for schemzip template matching."""

from __future__ import annotations

import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

from matcher import build_template_index, canonical_component_signature, canonical_template_signature, load_template_db, match_component


ROOT = Path(__file__).resolve().parent
TEMPLATE_DB_PATH = ROOT / "template_db.json"


def _cells_from_source_xml(source_xml: str):
    root = ET.fromstring(source_xml).find("root")
    if root is None:
        raise AssertionError("template xml missing root")
    return [cell for cell in root.findall("mxCell") if cell.get("id") not in {"0", "1"}]


class MatcherTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.template_db = load_template_db(TEMPLATE_DB_PATH)
        cls.template_index = build_template_index(cls.template_db)

    def test_template_signature_round_trip(self) -> None:
        template = self.template_db["templates"][0]
        cells = _cells_from_source_xml(template["source_xml"])
        self.assertEqual(canonical_template_signature(template), canonical_component_signature(cells))

    def test_match_component_detects_known_template(self) -> None:
        template = self.template_db["templates"][0]
        cells = _cells_from_source_xml(template["source_xml"])
        result = match_component(cells, self.template_index)
        self.assertTrue(result.matched)
        self.assertIsNotNone(result.template)
        self.assertEqual(result.template["name"], template["name"])

    def test_match_component_rejects_modified_geometry(self) -> None:
        template = self.template_db["templates"][0]
        cells = _cells_from_source_xml(template["source_xml"])
        mutated = [ET.fromstring(ET.tostring(cell, encoding="unicode")) for cell in cells]
        first_geom = mutated[0].find("mxGeometry")
        if first_geom is None or first_geom.get("width") is None:
            self.skipTest("template does not contain a modifiable geometry cell")
        first_geom.set("width", str(float(first_geom.get("width")) + 1.0))
        result = match_component(mutated, self.template_index)
        self.assertFalse(result.matched)
        self.assertIsNone(result.template)


if __name__ == "__main__":
    unittest.main()
