#!/usr/bin/env python3
"""Offline, read-only JUBO export reconciliation. Never emits cell values."""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
import hashlib
import json
from pathlib import Path
import re
import sys
import unicodedata
import xml.etree.ElementTree as ET
from zipfile import BadZipFile, ZipFile


SCHEMA_VERSION = "jubo-local-dry-run@1"
XML_NS = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
MAX_FILE_BYTES = 50 * 1024 * 1024
MAX_XLSX_UNCOMPRESSED_BYTES = 128 * 1024 * 1024
IDENTITY_FORMAT = re.compile(r"[A-Z][A-Z0-9]{7,19}\Z")
CELL_REF = re.compile(r"([A-Z]+)[0-9]+\Z")
DATE_TEXT = re.compile(r"([0-9]{4})[-/]([0-9]{1,2})[-/]([0-9]{1,2})\Z")

ROSTER_HEADERS = {
    "A": "組別/區域", "B": "編號", "C": "姓名", "D": "性別",
    "J": "首次服務日期", "P": "狀態", "X": "生日", "Z": "身分證字號",
    "AD": "聯絡電話",
}
ACTIVE_HEADERS = {
    "A": "組別/區域", "B": "編號", "D": "狀態", "E": "首次服務日期",
    "H": "姓名", "I": "性別", "J": "生日", "AD": "身分證字號",
}
STATUS = {"服務中": "active", "暫停服務": "suspended", "結案": "closed"}
SEX = {
    "男": "male", "男性": "male", "女": "female", "女性": "female",
    "其他": "other", "未知": "unknown",
}


class AuditError(Exception):
    """A safe, fixed error code; source values and paths never enter the code."""


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_xlsx_rows(path: Path) -> list[tuple[int, dict[str, str]]]:
    try:
        with ZipFile(path) as workbook:
            if sum(info.file_size for info in workbook.infolist()) > MAX_XLSX_UNCOMPRESSED_BYTES:
                raise AuditError("xlsx_uncompressed_limit")
            names = set(workbook.namelist())
            if "xl/worksheets/sheet1.xml" not in names:
                raise AuditError("xlsx_first_sheet_missing")
            if "xl/workbook.xml" in names:
                metadata = ET.fromstring(workbook.read("xl/workbook.xml"))
                properties = metadata.find("x:workbookPr", XML_NS)
                if properties is not None and properties.attrib.get("date1904") in {"1", "true"}:
                    raise AuditError("xlsx_date_system_unsupported")
            shared: list[str] = []
            if "xl/sharedStrings.xml" in names:
                strings = ET.fromstring(workbook.read("xl/sharedStrings.xml"))
                shared = [
                    "".join(t.text or "" for t in item.findall(".//x:t", XML_NS))
                    for item in strings.findall("x:si", XML_NS)
                ]
            sheet = ET.fromstring(workbook.read("xl/worksheets/sheet1.xml"))
            rows: list[tuple[int, dict[str, str]]] = []
            for row in sheet.findall(".//x:sheetData/x:row", XML_NS):
                cells: dict[str, str] = {}
                for cell in row.findall("x:c", XML_NS):
                    ref = CELL_REF.fullmatch(cell.attrib.get("r", ""))
                    if not ref:
                        raise AuditError("xlsx_cell_ref_invalid")
                    value_node = cell.find("x:v", XML_NS)
                    value = value_node.text or "" if value_node is not None else ""
                    if cell.attrib.get("t") == "s" and value:
                        value = shared[int(value)]
                    elif cell.attrib.get("t") == "inlineStr":
                        value = "".join(t.text or "" for t in cell.findall(".//x:t", XML_NS))
                    cells[ref.group(1)] = value.strip()
                rows.append((int(row.attrib["r"]), cells))
            return rows
    except (BadZipFile, ET.ParseError, KeyError, IndexError, ValueError, OSError) as error:
        raise AuditError("xlsx_unreadable") from error


def workbook_role(rows: list[tuple[int, dict[str, str]]]) -> tuple[str, int]:
    for role, header_row, expected in (
        ("roster", 5, ROSTER_HEADERS),
        ("active", 4, ACTIVE_HEADERS),
    ):
        header = next((cells for number, cells in rows if number == header_row), None)
        if header is not None and all(header.get(column) == label for column, label in expected.items()):
            return role, header_row
    raise AuditError("xlsx_schema_unrecognized")


def candidate_rows(
    rows: list[tuple[int, dict[str, str]]], _role: str, header_row: int
) -> list[tuple[int, dict[str, str]]]:
    # A source row can contain only its original ID, service date, or a field
    # outside today's candidate mapping. Keep every nonempty data row visible
    # for manual review instead of silently shrinking the source row count.
    return [
        (number, cells)
        for number, cells in rows
        if number > header_row and any(cells.values())
    ]


def normalized_identity(value: str) -> str:
    # Matches the intake contract's trim/uppercase only. No name or fuzzy match.
    return value.strip().upper()


def normalized_date(value: str) -> str | None:
    if not value:
        return None
    match = DATE_TEXT.fullmatch(value)
    if match:
        try:
            return date(*(int(part) for part in match.groups())).isoformat()
        except ValueError:
            return None
    try:
        serial = Decimal(value)
        if serial != int(serial) or not 2 <= serial <= 2_958_465 or serial == 60:
            return None
        return (date(1899, 12, 30) + timedelta(days=int(serial))).isoformat()
    except (InvalidOperation, OverflowError, ValueError):
        return None


def normalized_sex(value: str) -> str | None:
    return SEX.get(unicodedata.normalize("NFKC", value.strip()))


def row_ref(role: str, row_number: int, source_sha256: str) -> str:
    # A locator derived from file digest and row position, never a PII digest.
    locator = f"{source_sha256}:sheet1:{row_number}".encode("ascii")
    return f"{role}:{hashlib.sha256(locator).hexdigest()[:20]}"


def source_manifest(path: Path | None) -> dict[str, object]:
    if path is None:
        return {"present": False}
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise AuditError("manifest_unreadable") from error
    if not isinstance(manifest, dict):
        raise AuditError("manifest_schema_invalid")
    windows = manifest.get("windows")
    if not isinstance(windows, list):
        raise AuditError("manifest_schema_invalid")
    selected = manifest.get("selected_client_count")
    referenced = sum(isinstance(window, dict) and bool(window.get("file")) for window in windows)
    return {
        "present": True,
        "selected_client_count_claim": selected if type(selected) is int and selected >= 0 else None,
        "window_count": len(windows),
        "windows_with_file_reference_claim": referenced,
        "windows_without_file_reference_claim": len(windows) - referenced,
        "claim_is_not_service_history_proof": True,
    }


def audit_source(source_dir: Path) -> dict[str, object]:
    if not source_dir.is_dir() or source_dir.is_symlink():
        raise AuditError("source_directory_invalid")
    files = sorted(path for path in source_dir.iterdir() if path.is_file() or path.is_symlink())
    if not files:
        raise AuditError("source_directory_empty")
    for path in files:
        if path.is_symlink() or path.stat().st_size > MAX_FILE_BYTES:
            raise AuditError("source_file_invalid")
    workbooks: dict[str, dict[str, object]] = {}
    inventory: list[dict[str, object]] = []
    file_hashes: dict[Path, str] = {}
    manifest_path: Path | None = None
    pdfs: list[dict[str, object]] = []
    for path in files:
        suffix = path.suffix.lower()
        digest = sha256_file(path)
        file_hashes[path] = digest
        entry: dict[str, object] = {"type": suffix.removeprefix("."), "bytes": path.stat().st_size, "sha256": digest}
        if suffix == ".xlsx":
            rows = read_xlsx_rows(path)
            role, header_row = workbook_role(rows)
            if role in workbooks:
                raise AuditError("duplicate_workbook_role")
            workbooks[role] = {"rows": candidate_rows(rows, role, header_row), "sha256": digest}
            entry["role"] = role
        elif suffix == ".pdf":
            entry["role"] = "candidate_service_pdf"
            pdfs.append(entry)
        elif suffix == ".json":
            if manifest_path is not None:
                raise AuditError("duplicate_manifest")
            manifest_path = path
            entry["role"] = "source_manifest"
        elif suffix == ".md":
            entry["role"] = "source_note_unparsed"
        else:
            entry["role"] = "unsupported_unparsed"
        inventory.append(entry)
    if set(workbooks) != {"roster", "active"}:
        raise AuditError("required_workbooks_missing")

    roster_source_rows = workbooks["roster"]["rows"]
    active = workbooks["active"]["rows"]
    assert isinstance(roster_source_rows, list) and isinstance(active, list)
    # The reviewed export has an A-only trailing note. Keep it in source
    # evidence and manual review, but never count it as an approved client.
    # An A-only row amid client rows remains a candidate with missing fields.
    last_non_a_row = max((number for number, cells in roster_source_rows
        if any(value for column, value in cells.items() if column != "A")), default=0)
    possible_notes = [(number, cells) for number, cells in roster_source_rows
        if number > last_non_a_row and not any(value for column, value in cells.items() if column != "A")]
    possible_note_numbers = {number for number, _ in possible_notes}
    roster = [(number, cells) for number, cells in roster_source_rows
        if number not in possible_note_numbers]
    roster_sha = str(workbooks["roster"]["sha256"])
    active_sha = str(workbooks["active"]["sha256"])
    roster_by_id: dict[str, list[tuple[int, dict[str, str]]]] = defaultdict(list)
    active_by_id: dict[str, list[tuple[int, dict[str, str]]]] = defaultdict(list)
    for number, cells in roster:
        identity = normalized_identity(cells.get("Z", ""))
        if identity:
            roster_by_id[identity].append((number, cells))
    for number, cells in active:
        identity = normalized_identity(cells.get("AD", ""))
        if identity:
            active_by_id[identity].append((number, cells))

    field_quality = {
        "displayName": {"present": sum(bool(c.get("C")) for _, c in roster)},
        "identityNumber": {
            "present": sum(bool(c.get("Z")) for _, c in roster),
            "format_valid": sum(bool(IDENTITY_FORMAT.fullmatch(normalized_identity(c.get("Z", "")))) for _, c in roster),
        },
        "dateOfBirth": {
            "present": sum(bool(c.get("X")) for _, c in roster),
            "valid": sum(bool(normalized_date(c.get("X", ""))) for _, c in roster),
        },
        "sex": {
            "present": sum(bool(c.get("D")) for _, c in roster),
            "mapped": sum(bool(normalized_sex(c.get("D", ""))) for _, c in roster),
        },
        "phone": {"present": sum(bool(c.get("AD")) for _, c in roster)},
    }
    queue: list[dict[str, object]] = []
    exact_matches = 0
    disagreement_counts: Counter[str] = Counter()
    for number, cells in roster:
        reasons: set[str] = {"target_scope_unverified"}
        identity = normalized_identity(cells.get("Z", ""))
        if not cells.get("B"):
            reasons.add("source_client_number_missing")
        if not identity:
            reasons.add("identity_missing")
        elif not IDENTITY_FORMAT.fullmatch(identity):
            reasons.add("identity_format_invalid")
        elif len(roster_by_id[identity]) != 1:
            reasons.add("duplicate_roster_identity")
        if not cells.get("C"):
            reasons.add("display_name_missing")
        if cells.get("P") not in STATUS:
            reasons.add("status_unknown")
        elif cells["P"] != "服務中":
            reasons.add("lifecycle_review_required")
        if not normalized_date(cells.get("X", "")):
            reasons.add("birth_date_missing_or_invalid")
        if not normalized_sex(cells.get("D", "")):
            reasons.add("sex_unmapped")
        if not cells.get("J"):
            reasons.add("first_service_date_missing")
        elif not normalized_date(cells["J"]):
            reasons.add("first_service_date_invalid")
        if IDENTITY_FORMAT.fullmatch(identity) and len(roster_by_id[identity]) == 1:
            matches = active_by_id.get(identity, [])
            if cells.get("P") == "服務中" and len(matches) != 1:
                reasons.add("active_export_missing_or_duplicate")
            if len(matches) == 1:
                exact_matches += 1
                active_cells = matches[0][1]
                comparisons = {
                    "displayName": (cells.get("C", "").strip(), active_cells.get("H", "").strip()),
                    "dateOfBirth": (normalized_date(cells.get("X", "")), normalized_date(active_cells.get("J", ""))),
                    "sex": (normalized_sex(cells.get("D", "")), normalized_sex(active_cells.get("I", ""))),
                    "phone": (cells.get("AD", "").strip(), active_cells.get("W", "").strip()),
                }
                for field, (main_value, active_value) in comparisons.items():
                    if main_value != active_value:
                        reasons.add(f"export_disagreement_{field}")
                        disagreement_counts[field] += 1
                if active_cells.get("D") != cells.get("P"):
                    reasons.add("export_disagreement_status")
                    disagreement_counts["status"] += 1
        queue.append({
            "workbook_role": "roster", "sheet_row": number,
            "row_ref": row_ref("roster", number, roster_sha), "reasons": sorted(reasons),
        })
    for number, cells in active:
        identity = normalized_identity(cells.get("AD", ""))
        if not IDENTITY_FORMAT.fullmatch(identity) or len(active_by_id[identity]) != 1 or len(roster_by_id.get(identity, [])) != 1:
            queue.append({
                "workbook_role": "active", "sheet_row": number,
                "row_ref": row_ref("active", number, active_sha),
                "reasons": ["active_export_identity_unresolved"],
            })
    for number, _ in possible_notes:
        queue.append({
            "workbook_role": "roster", "sheet_row": number,
            "row_ref": row_ref("roster", number, roster_sha),
            "reasons": ["possible_trailing_source_note_or_incomplete_client"],
        })

    status_counts = Counter(STATUS.get(c.get("P", ""), "unknown") for _, c in roster)
    manifest = source_manifest(manifest_path)
    if manifest["present"] and manifest["selected_client_count_claim"] is not None:
        manifest["selected_client_count_agrees_with_candidate_rows"] = manifest["selected_client_count_claim"] == len(roster)
        manifest["selected_client_count_agrees_with_roster"] = (
            manifest["selected_client_count_claim"] == len(roster) and not possible_notes)
    result = {
        "schema_version": SCHEMA_VERSION,
        "mode": "offline_read_only",
        "database_connections": 0,
        "formal_records_written": 0,
        "source_files": sorted(inventory, key=lambda item: (str(item["role"]), str(item["sha256"]))),
        "source_manifest": manifest,
        "roster": {
            "rows": len(roster),
            "source_nonempty_rows": len(roster_source_rows),
            "possible_trailing_note_rows": len(possible_notes),
            "status_counts": dict(sorted(status_counts.items())),
            "source_client_number_present": sum(bool(c.get("B")) for _, c in roster),
            "first_service_date_present": sum(bool(c.get("J")) for _, c in roster),
            "first_service_date_valid": sum(bool(normalized_date(c.get("J", ""))) for _, c in roster),
            "field_quality": field_quality,
        },
        "cross_export_reconciliation": {
            "active_rows": len(active),
            "exact_identity_matches": exact_matches,
            "active_rows_unresolved": sum(
                not IDENTITY_FORMAT.fullmatch(identity) or len(active_by_id[identity]) != 1 or len(roster_by_id.get(identity, [])) != 1
                for _, c in active
                for identity in [normalized_identity(c.get("AD", ""))]
            ),
            "field_disagreement_counts": dict(sorted(disagreement_counts.items())),
            "matching_method": "normalized_exact_identity_within_source_exports_only",
        },
        "field_mapping": {
            "candidate_only": {
                "displayName": "roster.C / active.H",
                "identityNumber": "roster.Z / active.AD",
                "dateOfBirth": "roster.X / active.J",
                "sex": "roster.D / active.I (strict option map)",
                "phone": "roster.AD / active.W",
            },
            "not_mapped": [
                "source client number is missing; do not substitute case number",
                "first service date is source evidence, not admission or attendance",
                "status needs lifecycle review, not direct enum promotion",
                "addresses, CMS level, eligibility, signed plans and service details need owner review",
            ],
            "approved_for_promotion": False,
        },
        "service_history": {
            "pdf_candidate_files": len(pdfs),
            "formal_service_rows": 0,
            "complete_seven_year_history_established": False,
            "pdfs_parsed_or_promoted": False,
        },
        "manual_review_queue": queue,
        "promotion_gate": "blocked_pending_source_ids_target_snapshot_business_mapping_and_service_history",
    }
    if any(sha256_file(path) != digest for path, digest in file_hashes.items()):
        raise AuditError("source_changed_during_audit")
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Offline JUBO source audit; JSON to stdout, no writes")
    parser.add_argument("--source-dir", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        report = audit_source(args.source_dir)
    except AuditError as error:
        print(json.dumps({"error_code": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 2
    except Exception:
        # No exception detail: a third-party parser could include a source value or path.
        print(json.dumps({"error_code": "unexpected_audit_error"}), file=sys.stderr)
        return 2
    print(json.dumps(report, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
