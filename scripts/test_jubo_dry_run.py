"""Anonymous fixtures for the offline JUBO source audit."""

from __future__ import annotations

from datetime import date
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import xml.etree.ElementTree as ET
from zipfile import ZipFile

from jubo_dry_run import (
    ACTIVE_HEADERS,
    AuditError,
    ROSTER_HEADERS,
    audit_source,
    normalized_date,
    read_xlsx_rows,
)


NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"


def write_workbook(path: Path, header_row: int, headers: dict[str, str], records: list[dict[str, str]]) -> None:
    worksheet = ET.Element(f"{{{NS}}}worksheet")
    data = ET.SubElement(worksheet, f"{{{NS}}}sheetData")
    for row_number, fields in [(header_row, headers), *enumerate(records, header_row + 1)]:
        row = ET.SubElement(data, f"{{{NS}}}row", {"r": str(row_number)})
        for column, value in fields.items():
            if not value:
                continue
            cell = ET.SubElement(row, f"{{{NS}}}c", {"r": f"{column}{row_number}", "t": "inlineStr"})
            inline = ET.SubElement(cell, f"{{{NS}}}is")
            ET.SubElement(inline, f"{{{NS}}}t").text = value
    with ZipFile(path, "w") as archive:
        archive.writestr("xl/worksheets/sheet1.xml", ET.tostring(worksheet, encoding="utf-8"))


def fixture(root: Path, roster: list[dict[str, str]], active: list[dict[str, str]]) -> None:
    write_workbook(root / "roster.xlsx", 5, ROSTER_HEADERS, roster)
    write_workbook(root / "active.xlsx", 4, ACTIVE_HEADERS, active)
    (root / "candidate.pdf").write_bytes(b"%PDF-1.4\nsynthetic candidate only\n")
    (root / "manifest.json").write_text(
        json.dumps({"selected_client_count": len(roster), "windows": [{"file": None}]}),
        encoding="utf-8",
    )


class JuboDryRunTests(unittest.TestCase):
    def test_exact_identity_reconciliation_without_personal_values_in_report(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture(
                root,
                [
                    {"A": "1", "C": "測試甲", "D": "男性", "J": "2026/01/02", "P": "服務中", "X": "1940/01/01", "Z": "TEST000001", "AD": "0000000000"},
                    {"A": "1", "C": "測試乙", "D": "女性", "P": "結案", "X": "1941/01/01", "Z": "TEST000002"},
                ],
                [
                    {"A": "1", "D": "服務中", "H": "測試甲", "I": "男", "J": str((date(1940, 1, 1) - date(1899, 12, 30)).days) + ".0", "AD": "TEST000001", "W": "0000000000"},
                ],
            )
            before = {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in root.iterdir()}
            report = audit_source(root)
            after = {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in root.iterdir()}
            self.assertEqual(before, after)
            self.assertEqual(report["roster"]["rows"], 2)
            self.assertEqual(report["roster"]["status_counts"], {"active": 1, "closed": 1})
            self.assertEqual(report["roster"]["source_client_number_present"], 0)
            self.assertEqual(report["roster"]["first_service_date_present"], 1)
            self.assertEqual(report["roster"]["field_quality"]["sex"]["mapped"], 2)
            self.assertEqual(report["cross_export_reconciliation"]["exact_identity_matches"], 1)
            self.assertEqual(report["cross_export_reconciliation"]["field_disagreement_counts"], {})
            self.assertEqual(report["service_history"]["formal_service_rows"], 0)
            rendered = json.dumps(report, ensure_ascii=False)
            for secret in ("測試甲", "測試乙", "TEST000001", "TEST000002", "0000000000"):
                self.assertNotIn(secret, rendered)
            self.assertTrue(all("source_client_number_missing" in item["reasons"] for item in report["manual_review_queue"]))

    def test_same_name_without_identity_never_matches(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture(
                root,
                [{"C": "測試甲", "D": "女性", "P": "服務中", "X": "1940/01/01"}],
                [{"D": "服務中", "H": "測試甲", "I": "女", "J": "14611.0"}],
            )
            report = audit_source(root)
            self.assertEqual(report["cross_export_reconciliation"]["exact_identity_matches"], 0)
            self.assertEqual(report["cross_export_reconciliation"]["active_rows_unresolved"], 1)
            self.assertEqual(len(report["manual_review_queue"]), 2)
            self.assertIn("identity_missing", report["manual_review_queue"][0]["reasons"])

    def test_duplicate_identity_is_review_only(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture(
                root,
                [
                    {"C": "測試甲", "D": "男性", "P": "服務中", "X": "1940/01/01", "Z": "TEST000001"},
                    {"C": "測試乙", "D": "女性", "P": "服務中", "X": "1941/01/01", "Z": "TEST000001"},
                ],
                [{"D": "服務中", "H": "測試甲", "I": "男", "J": "14611.0", "AD": "TEST000001"}],
            )
            report = audit_source(root)
            self.assertEqual(report["cross_export_reconciliation"]["exact_identity_matches"], 0)
            self.assertEqual(report["cross_export_reconciliation"]["active_rows_unresolved"], 1)
            self.assertTrue(all("duplicate_roster_identity" in item["reasons"] for item in report["manual_review_queue"][:2]))

    def test_exact_identity_with_different_values_requires_review(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture(
                root,
                [{"C": "測試甲", "D": "男性", "P": "服務中", "X": "1940/01/01", "Z": "TEST000001", "AD": "0000000000"}],
                [{"D": "服務中", "H": "測試甲", "I": "男", "J": str((date(1940, 1, 1) - date(1899, 12, 30)).days) + ".0", "AD": "TEST000001", "W": "1111111111"}],
            )
            report = audit_source(root)
            self.assertEqual(report["cross_export_reconciliation"]["exact_identity_matches"], 1)
            self.assertEqual(report["cross_export_reconciliation"]["field_disagreement_counts"], {"phone": 1})
            self.assertIn("export_disagreement_phone", report["manual_review_queue"][0]["reasons"])
            rendered = json.dumps(report, ensure_ascii=False)
            self.assertNotIn("0000000000", rendered)
            self.assertNotIn("1111111111", rendered)

    def test_date_parser_is_strict(self) -> None:
        self.assertEqual(normalized_date("2026/01/02"), "2026-01-02")
        self.assertEqual(normalized_date("46024.0"), "2026-01-02")
        self.assertIsNone(normalized_date("2026/02/30"))
        self.assertIsNone(normalized_date("46024.5"))
        self.assertIsNone(normalized_date("yesterday"))

    def test_1904_date_system_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "synthetic.xlsx"
            write_workbook(path, 5, ROSTER_HEADERS, [])
            metadata = ET.Element(f"{{{NS}}}workbook")
            ET.SubElement(metadata, f"{{{NS}}}workbookPr", {"date1904": "1"})
            with ZipFile(path, "a") as archive:
                archive.writestr("xl/workbook.xml", ET.tostring(metadata, encoding="utf-8"))
            with self.assertRaisesRegex(AuditError, "xlsx_date_system_unsupported"):
                read_xlsx_rows(path)


if __name__ == "__main__":
    unittest.main()
