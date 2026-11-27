import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import pandas as pd
import yaml


ETL_DIR = Path(__file__).resolve().parent
TRANSFORM = ETL_DIR / "transform.py"
MAPPING = ETL_DIR / "config" / "mapping.yaml"
INPUT_DIR = ETL_DIR / "input"
EXPECTED_COLUMNS = [
    "date",
    "head",
    "category",
    "vendor",
    "vendor_kind",
    "line_item",
    "amount",
    "direction",
    "flat_code",
    "source_ref",
]


def norm(value):
    return " ".join(str(value).strip().split()).lower()


class TransformIntegrationTests(unittest.TestCase):
    maxDiff = None

    def setUp(self):
        self.temp_dir = Path(tempfile.mkdtemp(prefix="etl-transform-test-"))
        self.addCleanup(shutil.rmtree, self.temp_dir, True)
        (self.temp_dir / "config").mkdir()
        (self.temp_dir / "input").mkdir()
        shutil.copy2(TRANSFORM, self.temp_dir / "transform.py")
        shutil.copy2(MAPPING, self.temp_dir / "config" / "mapping.yaml")

    def run_transform(self, input_files):
        for source in input_files:
            shutil.copy2(source, self.temp_dir / "input" / source.name)
        result = subprocess.run(
            [sys.executable, "transform.py"],
            cwd=self.temp_dir,
            text=True,
            capture_output=True,
            timeout=120,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        output = self.temp_dir / "output"
        self.assertTrue((output / "transactions.csv").is_file())
        self.assertTrue((output / "transactions.xlsx").is_file())
        self.assertTrue((output / "vendor_mapping_gaps.csv").is_file())
        return pd.read_csv(output / "transactions.csv", dtype={"flat_code": str, "source_ref": str})

    def primary_inputs(self):
        return sorted(path for path in INPUT_DIR.iterdir() if path.is_file())

    def test_mapping_structure_and_alias_targets_are_valid(self):
        config = yaml.safe_load(MAPPING.read_text(encoding="utf-8"))
        aliases = {norm(source): str(target) for source, target in config["line_item_aliases"].items()}
        expense_items = {norm(item): category for category, items in config["expense_categories"].items() for item in items}
        income_items = {norm(item): category for category, items in config["income_categories"].items() for item in items}
        reference_items = {norm(item) for item in config.get("collection_reference_categories", {})}

        for source, target in aliases.items():
            target_norm = norm(target)
            self.assertTrue(
                source in expense_items or source in income_items or target_norm in expense_items or target_norm in income_items or target_norm in reference_items,
                f"Alias source/target is not categorised: {source} -> {target}",
            )

        overlap = set(expense_items) & set(income_items)
        self.assertFalse(overlap, f"Line items mapped as both expense and income: {sorted(overlap)}")

        for line_item, excluded in config.get("vendor_exclusions", {}).items():
            self.assertIn(norm(line_item), {**expense_items, **income_items})
            self.assertTrue(excluded)
            candidates = config.get("vendor_candidates", {}).get(line_item, [])
            self.assertFalse(set(excluded) & set(candidates), f"Excluded vendors still present for {line_item}")

    def test_latest_input_set_generates_valid_transactions(self):
        transactions = self.run_transform(self.primary_inputs())
        self.assertGreater(len(transactions), 700)
        self.assertEqual(list(transactions.columns), EXPECTED_COLUMNS)
        self.assertFalse(transactions[["date", "head", "category", "vendor", "line_item", "amount", "direction"]].isna().any().any())
        self.assertTrue(set(transactions["head"]).issubset({"expense", "income", "reference"}))
        self.assertTrue(set(transactions["direction"]).issubset({"C", "D"}))
        self.assertTrue(pd.to_datetime(transactions["date"], format="%Y-%m-%d", errors="coerce").notna().all())
        self.assertTrue(pd.to_numeric(transactions["amount"], errors="coerce").notna().all())
        self.assertFalse((transactions["line_item"].astype(str).str.strip() == "").any())

        xlsx = pd.read_excel(self.temp_dir / "output" / "transactions.xlsx", sheet_name="Transactions")
        self.assertEqual(len(xlsx), len(transactions))
        self.assertEqual(list(xlsx.columns), EXPECTED_COLUMNS)

    def test_aliases_are_applied_to_output_but_not_vendor_lookup(self):
        transactions = self.run_transform(self.primary_inputs())
        expected = {
            "Salon": "Creaatio",
            "Day Care": "Creche",
            "Laundry": "Laundry Pro",
        }
        for line_item, vendor in expected.items():
            rows = transactions[transactions["line_item"] == line_item]
            self.assertFalse(rows.empty, f"Missing aliased line item: {line_item}")
            self.assertEqual(set(rows["category"]), {"Commercial Income"})
            self.assertEqual(set(rows["vendor"]), {vendor})
        self.assertFalse(transactions["line_item"].isin(expected.values()).any())

    def test_vendor_exclusions_survive_vendor_report_reprocessing(self):
        transactions = self.run_transform(self.primary_inputs())
        restricted = transactions[transactions["line_item"].isin(["Diesel", "Tools & Stationary"])]
        self.assertFalse(restricted.empty)
        self.assertFalse(restricted["vendor"].str.contains("EXOZEN", case=False, na=False).any())
        self.assertEqual(set(restricted[restricted["line_item"] == "Diesel"]["vendor"]), {"Multiple Vendors (Sai Krupa Petroleum / Sai Abhay Petroleum)"})
        self.assertEqual(set(restricted[restricted["line_item"] == "Tools & Stationary"]["vendor"]), {"AM Computers INC"})

        config_after_run = yaml.safe_load((self.temp_dir / "config" / "mapping.yaml").read_text(encoding="utf-8"))
        for line_item in ("Diesel", "Tools & Stationary"):
            self.assertNotIn("EXOZEN", config_after_run["vendor_candidates"][line_item])

    def test_equipment_amc_line_items_share_one_category(self):
        transactions = self.run_transform(self.primary_inputs())
        maintenance_items = ["AMC (Lift)", "AMC (AC)", "AMC (DG)", "DG Service"]
        rows = transactions[transactions["line_item"].isin(maintenance_items)]
        self.assertFalse(rows.empty)
        self.assertEqual(set(rows["category"]), {"Equipment AMC & Maintenance"})
        self.assertEqual(set(rows["line_item"]), set(maintenance_items))

    def test_zero_amount_rows_are_not_exported(self):
        transactions = self.run_transform(self.primary_inputs())
        self.assertFalse((transactions["amount"].astype(float) == 0).any())

    def test_vendor_parse_errors_are_reported_without_stopping_output(self):
        invalid = self.temp_dir / "input" / "Vendor invalid.xls"
        pd.DataFrame({"Wrong Header": ["value"]}).to_excel(invalid, index=False)
        transactions = self.run_transform(self.primary_inputs())
        self.assertGreater(len(transactions), 0)
        gaps = pd.read_csv(self.temp_dir / "output" / "vendor_mapping_gaps.csv")
        errors = gaps[gaps["classification"] == "VENDOR_REPORT_PARSE_ERROR"]
        self.assertIn("Vendor invalid.xls", set(errors["source_file"]))

    def test_all_available_backup_input_variants_are_processed(self):
        backups = INPUT_DIR / "File_Backups"
        variants = {
            "old": sorted(path for path in backups.iterdir() if "_Old" in path.name or "as on Aug26" in path.name or path.name.startswith("Vendor")),
            "latest": sorted(path for path in backups.iterdir() if "_Latest" in path.name or path.name in {
                "Collection & SQFT Report as of Nov26_org.xlsx",
                "Collection & SQFT Report as of Nov26.xlsx",
            } or path.name.startswith("Vendor")),
        }
        for name, files in variants.items():
            with self.subTest(variant=name):
                case_dir = self.temp_dir / name
                case_dir.mkdir()
                (case_dir / "config").mkdir()
                (case_dir / "input").mkdir()
                shutil.copy2(TRANSFORM, case_dir / "transform.py")
                shutil.copy2(MAPPING, case_dir / "config" / "mapping.yaml")
                for source in files:
                    shutil.copy2(source, case_dir / "input" / source.name)
                result = subprocess.run(
                    [sys.executable, "transform.py"],
                    cwd=case_dir,
                    text=True,
                    capture_output=True,
                    timeout=120,
                    check=False,
                )
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                generated = pd.read_csv(case_dir / "output" / "transactions.csv")
                self.assertGreater(len(generated), 100)
                self.assertTrue(set(generated["head"]).issubset({"expense", "income", "reference"}))
                restricted = generated[generated["line_item"].isin(["Diesel", "Tools & Stationary"])]
                self.assertFalse(restricted["vendor"].astype(str).str.contains("EXOZEN", case=False, na=False).any())

    def test_reprocessing_same_reports_is_deterministic(self):
        first = self.run_transform(self.primary_inputs())
        mapping_first = (self.temp_dir / "config" / "mapping.yaml").read_text(encoding="utf-8")
        first_normalized = first.sort_values(EXPECTED_COLUMNS).reset_index(drop=True)

        for source in self.primary_inputs():
            shutil.copy2(source, self.temp_dir / "input" / source.name)
        subprocess.run([sys.executable, "transform.py"], cwd=self.temp_dir, check=True, capture_output=True, text=True, timeout=120)
        second = pd.read_csv(self.temp_dir / "output" / "transactions.csv", dtype={"flat_code": str, "source_ref": str})
        second_normalized = second.sort_values(EXPECTED_COLUMNS).reset_index(drop=True)

        pd.testing.assert_frame_equal(first_normalized, second_normalized)
        mapping_second = (self.temp_dir / "config" / "mapping.yaml").read_text(encoding="utf-8")
        self.assertEqual(mapping_first, mapping_second)


if __name__ == "__main__":
    unittest.main(verbosity=2)
