#!/usr/bin/env python3
"""Regression tests for the Stata house-style semantic boundary."""

import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "stata_house_style.py"
SPEC = importlib.util.spec_from_file_location("stata_house_style", SCRIPT)
assert SPEC and SPEC.loader
STYLE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(STYLE)


class ActiveCodeInvariantTests(unittest.TestCase):
    def test_command_boundaries_are_protected(self):
        separate = "local a 1\ndisplay 2\n"
        joined = "local a 1 display 2\n"
        self.assertNotEqual(STYLE.compute_code_hash(separate), STYLE.compute_code_hash(joined))

    def test_line_continuation_is_protected(self):
        continued = "display 1 + /// continue\n    2\n"
        stopped = "display 1 + // stop\n    2\n"
        self.assertNotEqual(STYLE.compute_code_hash(continued), STYLE.compute_code_hash(stopped))

    def test_line_after_continuation_is_protected_even_when_blank(self):
        blank_next_line = "display 1 + /// continue\n\n2\n"
        no_blank_line = "display 1 + /// continue\n2\n"
        self.assertNotEqual(STYLE.compute_code_hash(blank_next_line), STYLE.compute_code_hash(no_blank_line))

    def test_active_physical_line_is_preserved_exactly(self):
        source = "* old section\ngenerate x = 1   /* keep this comment */   \n"
        recipe = {
            "banners": [{
                "level": 1,
                "number": "1",
                "title": "Build Variables",
                "original_start_line": 1,
                "original_end_line": 1,
            }]
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "test.do"
            path.write_text(source, encoding="utf-8")
            lines, before, after, mode = STYLE.apply_recipe(str(path), recipe)
        self.assertEqual(before, after)
        self.assertEqual(mode, "exact-active-lines")
        self.assertIn("generate x = 1   /* keep this comment */   ", lines)

    def test_recipe_cannot_target_active_code(self):
        source = "* old section\ngenerate x = 1\n"
        recipe = {
            "banners": [{
                "level": 1,
                "number": "1",
                "title": "Bad Range",
                "original_start_line": 2,
                "original_end_line": 2,
            }]
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "test.do"
            path.write_text(source, encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "targets active code"):
                STYLE.apply_recipe(str(path), recipe)

    def test_unknown_recipe_fields_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "test.do"
            path.write_text("display 1\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "unknown recipe field"):
                STYLE.apply_recipe(str(path), {"baners": []})

    def test_width_is_limited_to_supported_layouts(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "test.do"
            path.write_text("display 1\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "width must be 64 or 72"):
                STYLE.apply_recipe(str(path), {}, width=80)

    def test_header_metadata_cannot_inject_new_lines(self):
        recipe = {"header": {"filename": "safe.do\ndisplay 1"}}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "test.do"
            path.write_text("display 1\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "must not contain line breaks"):
                STYLE.apply_recipe(str(path), recipe)

    def test_overlapping_ranges_are_rejected(self):
        source = "* header\n* section\ngenerate x = 1\n"
        recipe = {
            "header": {
                "filename": "test.do",
                "Purpose": "Test overlap handling.",
                "original_start_line": 1,
                "original_end_line": 2,
            },
            "banners": [{
                "level": 1,
                "number": "1",
                "title": "Overlap",
                "original_start_line": 2,
                "original_end_line": 2,
            }],
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "test.do"
            path.write_text(source, encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "overlaps"):
                STYLE.apply_recipe(str(path), recipe)


class PreambleBoundaryTests(unittest.TestCase):
    def test_preamble_recipe_requires_explicit_flag(self):
        source = "clear all\ndisplay 1\n"
        recipe = {"preamble": {"original_start_line": 1, "original_end_line": 1}}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "test.do"
            path.write_text(source, encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "--preamble was not supplied"):
                STYLE.apply_recipe(str(path), recipe)

    def test_preamble_flag_requires_recipe_object(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "test.do"
            path.write_text("clear all\ndisplay 1\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "requires a preamble object"):
                STYLE.apply_recipe(str(path), {}, enable_preamble=True)

    def test_preamble_globals_file_must_be_simple_filename(self):
        source = "clear all\ndisplay 1\n"
        recipe = {
            "preamble": {
                "original_start_line": 1,
                "original_end_line": 1,
                "globals_file": "../project_globals.do",
            }
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "test.do"
            path.write_text(source, encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "simple .do filename"):
                STYLE.apply_recipe(str(path), recipe, enable_preamble=True)

    def test_generated_loader_fails_closed(self):
        preamble = "\n".join(STYLE.format_preamble({"globals_file": "project_globals.do"}))
        self.assertIn('do "project_globals.do"', preamble)
        self.assertNotIn('capture do "project_globals.do"', preamble)
        self.assertIn("exit 601", preamble)
        self.assertIn("exit 198", preamble)

    def test_preamble_cannot_consume_whole_file(self):
        source = "generate x = 1\nreplace x = 2\nsave \"out.dta\", replace\n"
        recipe = {
            "preamble": {
                "original_start_line": 1,
                "original_end_line": 3,
            }
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "test.do"
            path.write_text(source, encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "must leave protected active code"):
                STYLE.apply_recipe(str(path), recipe, enable_preamble=True)

    def test_preamble_rejects_substantive_commands(self):
        source = "clear all\ngenerate x = 1\ndisplay x\n"
        recipe = {
            "preamble": {
                "original_start_line": 1,
                "original_end_line": 2,
            }
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "test.do"
            path.write_text(source, encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "unsupported active code"):
                STYLE.apply_recipe(str(path), recipe, enable_preamble=True)

    def test_preamble_does_not_normalize_body_strings(self):
        source = "clear all\nlocal literal \"A\\B\"\ndisplay \"`literal'\"\n"
        recipe = {
            "preamble": {
                "original_start_line": 1,
                "original_end_line": 1,
                "globals_file": "project_globals.do",
                "legacy_path_alias": True,
                "version": "17",
            }
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "test.do"
            path.write_text(source, encoding="utf-8")
            lines, before, after, mode = STYLE.apply_recipe(
                str(path), recipe, enable_preamble=True
            )
        self.assertEqual(before, after)
        self.assertEqual(mode, "exact-body-with-preamble-exception")
        self.assertIn('local literal "A\\B"', lines)
        self.assertNotIn('local literal "A/B"', lines)

    def test_path_normalization_is_rejected(self):
        source = "display \"A\\B\"\n"
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "test.do"
            path.write_text(source, encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "semantic refactor"):
                STYLE.apply_recipe(str(path), {}, normalize_paths=True)


class ProseFormattingTests(unittest.TestCase):
    def test_short_unlabeled_prose_becomes_star_comment(self):
        wrapped = STYLE.wrap_prose_block("/* Rename source variables. */", width=64)
        self.assertEqual(wrapped, ["* Rename source variables."])

    def test_short_status_note_remains_full_block(self):
        wrapped = STYLE.wrap_prose_block("/* NOTE: Confirm the source vintage. */", width=64)
        self.assertEqual(wrapped, ["/*", "NOTE: Confirm the source vintage.", "*/"])

    def test_retired_status_labels_are_normalized(self):
        warning = STYLE.wrap_prose_block("* WARNING: Preserve OBJECTID ordering.", width=64)
        todo = STYLE.wrap_prose_block("* TODO: Confirm the source vintage.", width=64)
        fixme = STYLE.wrap_prose_block("* FIXME: Correct the merge key.", width=64)
        self.assertEqual(warning[1], "NOTE: Preserve OBJECTID ordering.")
        self.assertEqual(todo[1], "ISSUE: Confirm the source vintage.")
        self.assertEqual(fixme[1], "ISSUE: Correct the merge key.")

    def test_status_labels_are_normalized_to_uppercase(self):
        wrapped = STYLE.wrap_prose_block("* verify: Confirm the source vintage.", width=64)
        self.assertEqual(wrapped[1], "VERIFY: Confirm the source vintage.")

    def test_targeted_star_status_note_becomes_block_with_one_blank_after(self):
        source = "* NOTE: Confirm the source vintage.\n\n\nuse source.dta, clear\n"
        recipe = {
            "prose_blocks": [{
                "type": "prose",
                "original_start_line": 1,
                "original_end_line": 1,
            }]
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "test.do"
            path.write_text(source, encoding="utf-8")
            lines, before, after, _ = STYLE.apply_recipe(str(path), recipe)
        self.assertEqual(before, after)
        self.assertEqual(
            lines[:5],
            ["/*", "NOTE: Confirm the source vintage.", "*/", "", "use source.dta, clear"],
        )

    def test_targeted_short_prose_has_no_blank_before_associated_code(self):
        source = "/* Rename source variables. */\n\nrename old new\n"
        recipe = {
            "prose_blocks": [{
                "type": "prose",
                "original_start_line": 1,
                "original_end_line": 1,
            }]
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "test.do"
            path.write_text(source, encoding="utf-8")
            lines, before, after, _ = STYLE.apply_recipe(str(path), recipe)
        self.assertEqual(before, after)
        self.assertEqual(lines[:2], ["* Rename source variables.", "rename old new"])

    def test_targeted_prose_has_one_blank_before_when_following_code(self):
        source = "generate x = 1\n\n\n/* Inspect the result. */\nsummarize x\n"
        recipe = {
            "prose_blocks": [{
                "type": "prose",
                "original_start_line": 4,
                "original_end_line": 4,
            }]
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "test.do"
            path.write_text(source, encoding="utf-8")
            lines, before, after, _ = STYLE.apply_recipe(str(path), recipe)
        self.assertEqual(before, after)
        self.assertEqual(
            lines[:4],
            ["generate x = 1", "", "* Inspect the result.", "summarize x"],
        )

    def test_findings_leadin_is_not_folded_into_prior_bullet(self):
        raw = """/*
Address notes:
  - First condition.
Findings:
  - Second condition.
*/"""
        wrapped = STYLE.wrap_prose_block(raw, width=64, is_notes=True)
        findings_index = wrapped.index("Findings:")
        self.assertEqual(wrapped[findings_index - 1], "")
        self.assertFalse(any("First condition. Findings:" in line for line in wrapped))


class PreambleCarryThroughTests(unittest.TestCase):
    def test_authored_globals_survive_replacement(self):
        lines = STYLE.format_preamble(
            {"version": "17"},
            source_lines=[
                "clear matrix",
                "clear all",
                "global date 9-11-2025",
                'global path "D:\\Research\\Detroit Blight"',
                'cd "$path"',
            ],
        )
        self.assertIn("global date 9-11-2025", lines)
        self.assertNotIn('global path "D:\\Research\\Detroit Blight"', lines)
        self.assertNotIn("clear matrix", lines)
        self.assertNotIn('cd "$path"', lines)

    def test_generated_globals_are_regenerated_not_carried(self):
        lines = STYLE.format_preamble(
            {"version": "17"},
            source_lines=['global data "$root/Data"'],
        )
        self.assertNotIn('global data "$root/Data"', lines)

    def test_carried_globals_follow_the_loader(self):
        lines = STYLE.format_preamble(
            {"version": "17"},
            source_lines=["global date 9-11-2025"],
        )
        self.assertGreater(
            lines.index("global date 9-11-2025"),
            lines.index('do "project_globals.do"'),
        )


class EscalationGuardTests(unittest.TestCase):
    def _config(self, directory, yolo):
        path = Path(directory) / "permission-system.json"
        path.write_text(json.dumps({"enabled": True, "yoloMode": yolo}), encoding="utf-8")
        return str(path)

    def test_direct_invocation_allows_escalation(self):
        environment = dict(os.environ)
        environment.pop("PI_PERMISSION_SYSTEM_CONFIG_PATH", None)
        with mock.patch.dict(os.environ, environment, clear=True):
            allowed, _ = STYLE.escalation_available()
        self.assertTrue(allowed)

    def test_auto_mode_blocks_escalation(self):
        with tempfile.TemporaryDirectory() as directory:
            config = self._config(directory, True)
            with mock.patch.dict(os.environ, {"PI_PERMISSION_SYSTEM_CONFIG_PATH": config}):
                allowed, reason = STYLE.escalation_available()
        self.assertFalse(allowed)
        self.assertIn("/auto", reason)

    def test_manual_mode_allows_escalation(self):
        with tempfile.TemporaryDirectory() as directory:
            config = self._config(directory, False)
            with mock.patch.dict(os.environ, {"PI_PERMISSION_SYSTEM_CONFIG_PATH": config}):
                allowed, _ = STYLE.escalation_available()
        self.assertTrue(allowed)

    def test_unreadable_config_fails_closed(self):
        with mock.patch.dict(os.environ, {"PI_PERMISSION_SYSTEM_CONFIG_PATH": "/nonexistent/x.json"}):
            allowed, _ = STYLE.escalation_available()
        self.assertFalse(allowed)

    def test_guard_is_off_by_default_so_auto_runs_unattended(self):
        environment = dict(os.environ)
        environment["PI_PERMISSION_SYSTEM_CONFIG_PATH"] = "/nonexistent/x.json"
        environment.pop("STATA_HOUSE_STYLE_REQUIRE_CONFIRMATION", None)
        with mock.patch.dict(os.environ, environment, clear=True):
            # /auto blocks ask_user, yet these must still proceed.
            STYLE.require_escalation({"preamble": {"original_start_line": 1}}, True, False)
            STYLE.require_escalation(
                {"path_rewrites": [{"original_start_line": 1}]}, False, True
            )

    def test_opt_in_guard_still_only_fires_for_active_line_edits(self):
        comments_only = {"prose_blocks": [{"original_start_line": 1, "original_end_line": 1}]}
        environment = {
            "PI_PERMISSION_SYSTEM_CONFIG_PATH": "/nonexistent/x.json",
            "STATA_HOUSE_STYLE_REQUIRE_CONFIRMATION": "1",
        }
        with mock.patch.dict(os.environ, environment, clear=True):
            STYLE.require_escalation(comments_only, False, False)
            with self.assertRaises(ValueError):
                STYLE.require_escalation({"preamble": {"original_start_line": 1}}, True, False)
            with self.assertRaises(ValueError):
                STYLE.require_escalation(
                    {"path_rewrites": [{"original_start_line": 1}]}, False, True
                )

    def test_opt_in_guard_permits_edits_when_escalation_is_available(self):
        with tempfile.TemporaryDirectory() as directory:
            config = self._config(directory, False)
            environment = {
                "PI_PERMISSION_SYSTEM_CONFIG_PATH": config,
                "STATA_HOUSE_STYLE_REQUIRE_CONFIRMATION": "1",
            }
            with mock.patch.dict(os.environ, environment, clear=True):
                STYLE.require_escalation({"preamble": {"original_start_line": 1}}, True, False)


class PathRewriteValidationTests(unittest.TestCase):
    def test_approved_move_is_accepted(self):
        before = 'save "$path\\Temp\\out.dta", replace'
        after = 'save "$temp/out.dta", replace'
        self.assertEqual(
            STYLE.validate_path_rewrite(before, after),
            ["$path\\Temp\\ -> $temp/"],
        )

    def test_every_approved_folder_is_accepted(self):
        for global_name, folder in STYLE.PROJECT_PATH_GLOBALS.items():
            before = 'use "$path\\%s\\f.dta"' % folder
            after = 'use "$%s/f.dta"' % global_name
            self.assertTrue(STYLE.validate_path_rewrite(before, after))

    def test_rename_is_rejected(self):
        with self.assertRaises(ValueError):
            STYLE.validate_path_rewrite('save "$path\\Temp\\out.dta"', 'save "$temp/out2.dta"')

    def test_miswire_is_rejected(self):
        with self.assertRaises(ValueError):
            STYLE.validate_path_rewrite('log using "$path\\Results\\r.log"', 'log using "$temp/r.log"')

    def test_text_change_outside_quotes_is_rejected(self):
        with self.assertRaises(ValueError):
            STYLE.validate_path_rewrite('save "$path\\Temp\\out.dta"', 'capture save "$temp/out.dta"')

    def test_extra_quoted_string_is_rejected(self):
        with self.assertRaises(ValueError):
            STYLE.validate_path_rewrite('save "$path\\Temp\\o.dta"', 'save "$temp/o.dta", "x"')

    def test_unknown_folder_is_rejected(self):
        with self.assertRaises(ValueError):
            STYLE.validate_path_rewrite('do "$path\\Programs\\x.do"', 'do "$programs/x.do"')

    def test_unchanged_line_is_rejected(self):
        with self.assertRaises(ValueError):
            STYLE.validate_path_rewrite('save "$temp/out.dta"', 'save "$temp/out.dta"')


class PathIntegrityTests(unittest.TestCase):
    def test_approved_moves_pass(self):
        original = 'log using "$path\\Results\\r.log"\nsave "$path\\Temp\\o.dta"\n'
        result = 'log using "$results/r.log"\nsave "$temp/o.dta"\n'
        mappings, problems = STYLE.verify_path_integrity(original, result)
        self.assertEqual(problems, [])
        self.assertEqual(len(mappings), 2)

    def test_unchanged_paths_pass(self):
        text = 'save "$temp/o.dta"\n'
        mappings, problems = STYLE.verify_path_integrity(text, text)
        self.assertEqual(problems, [])
        self.assertEqual(len(mappings), 1)

    def test_renamed_file_fails(self):
        original = 'save "$path\\Temp\\o.dta"\n'
        result = 'save "$temp/o2.dta"\n'
        _, problems = STYLE.verify_path_integrity(original, result)
        self.assertTrue(problems)

    def test_removed_path_fails(self):
        original = 'save "$path\\Temp\\o.dta"\nuse "$path\\Data\\i.dta"\n'
        result = 'save "$temp/o.dta"\n'
        _, problems = STYLE.verify_path_integrity(original, result)
        self.assertTrue(any("removed" in problem for problem in problems))


class ScanAdvisoryTests(unittest.TestCase):
    def test_reports_hardcoded_root_and_backslash_paths(self):
        lines = [
            'global path "D:\\Research\\Detroit Blight"',
            'cd "$path"',
            'save "$path\\Temp\\o.dta", replace',
        ]
        kinds = [a["kind"] for a in STYLE.scan_advisories(lines)]
        self.assertIn("hardcoded_root", kinds)
        self.assertEqual(kinds.count("backslash_path"), 1)

    def test_absolute_cd_is_reported(self):
        kinds = [a["kind"] for a in STYLE.scan_advisories(['cd "D:\\Research"'])]
        self.assertIn("absolute_cd", kinds)

    def test_latex_backslashes_are_not_reported(self):
        lines = ['file write `fh\' "\\item Notes: 22{,}000 homes" _n']
        self.assertEqual(STYLE.scan_advisories(lines), [])

    def test_comment_lines_are_not_reported(self):
        self.assertEqual(STYLE.scan_advisories(['* save "$path\\Temp\\o.dta"']), [])


if __name__ == "__main__":
    unittest.main()
