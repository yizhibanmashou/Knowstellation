import sys
import unittest

sys.path.insert(0, "scripts")

from build_dependencies import (  # noqa: E402
    build_global_symbol_index,
    build_chapter_dependency,
    build_dependencies_for_chapter,
    build_symbol_sense_clusters,
    canonical_symbol_key,
    EDGE_COMPOUND,
    edge_status,
    extract_chapter_text_defined_symbols,
    formula_sort_key,
    is_stoplisted_symbol,
    register_formula_senses,
    should_keep_variable_definition,
    variable_definition_text,
)
from symbol_extraction import extract_symbols  # noqa: E402


class SymbolExtractionTest(unittest.TestCase):
    def test_filters_math_operators(self):
        result = extract_symbols(r"E(t)=-\frac{4Np\ln(p)}{1-p}")
        used = {item["symbol"] for item in result["symbols_used"]}
        defined = {item["symbol"] for item in result["symbols_defined"]}

        self.assertNotIn("E", used)
        self.assertNotIn(r"\ln", used)
        self.assertNotIn("E", defined)
        self.assertEqual(defined, {"t"})

    def test_preserves_teacher_compound_notation(self):
        result = extract_symbols(r"F_{ST}=\frac{1}{1+4Nm}")
        used = {item["symbol"] for item in result["symbols_used"]}
        defined = {item["symbol"] for item in result["symbols_defined"]}

        self.assertIn("F_{ST}", used)
        self.assertIn("F_{ST}", defined)
        self.assertNotIn("F", used)
        self.assertNotIn("S", used)
        self.assertNotIn("T", used)

    def test_canonicalizes_bar_without_merging_hat_tilde_or_plain(self):
        bar = extract_symbols(r"\bar{t}_c+\overline{t}_f")
        bar_by_symbol = {item["symbol"]: item for item in bar["symbols_used_detailed"]}
        self.assertEqual(bar_by_symbol[r"\bar{t}_c"]["canonical_latex"], r"\overline{t}_c")
        self.assertEqual(bar_by_symbol[r"\overline{t}_f"]["canonical_latex"], r"\overline{t}_f")
        self.assertNotIn(r"\bar{t}", bar_by_symbol)

        decorated = extract_symbols(r"\hat{p}+\tilde{p}+p")
        exact_keys = {item["symbol"]: item["exact_key"] for item in decorated["symbols_used_detailed"]}
        self.assertEqual(exact_keys[r"\hat{p}"], r"\hat{p}")
        self.assertEqual(exact_keys[r"\tilde{p}"], r"\tilde{p}")
        self.assertEqual(exact_keys["p"], "p")

    def test_function_call_name_is_not_a_variable(self):
        result = extract_symbols(r"F(1-i,2N-1,2N,x)")
        used = {item["symbol"] for item in result["symbols_used"]}

        self.assertNotIn("F", used)

    def test_sigma_morphism_separates_covariance_variance_and_matrix(self):
        result = extract_symbols(r"S=\sigma(w,z)+\sigma_A^2(W)+\mathbf{\Sigma}")
        by_symbol = {item["symbol"]: item for item in result["symbols_used_detailed"]}

        self.assertNotIn(r"\sigma", by_symbol)
        self.assertEqual(by_symbol[r"\sigma_A^2(W)"]["role"], "statistic_variance")
        self.assertEqual(by_symbol[r"\sigma_A^2(W)"]["family_key"], r"\sigma_var")
        self.assertEqual(by_symbol[r"\mathbf{\Sigma}"]["role"], "matrix_symbol")
        self.assertEqual(by_symbol[r"\mathbf{\Sigma}"]["family_key"], r"\Sigma_matrix")

    def test_splits_ocr_glued_symbols_before_extraction(self):
        result = extract_symbols(
            r"R_W=h_W^2S_W={\sigma_A^2(W)\over\sigma^2(W)}{\sigma^2(W)\over\overline{W}}"
        )
        used = {item["symbol"] for item in result["symbols_used"]}

        self.assertIn("h_W^2", used)
        self.assertIn("S_W", used)
        self.assertNotIn("h_W^2S_W", used)
        self.assertNotIn("A^2", used)

    def test_dependency_canonical_strips_nonsemantic_math_fonts(self):
        self.assertEqual(canonical_symbol_key(r"\mathbf{P}"), "P")
        self.assertEqual(canonical_symbol_key(r"\mathbf P"), "P")
        self.assertEqual(canonical_symbol_key(r"\boldsymbol{\mu}"), r"\mu")
        self.assertEqual(canonical_symbol_key(r"\boldsymbol \mu"), r"\mu")
        self.assertEqual(canonical_symbol_key(r"\mathbb{P}_{ij}"), "P_{ij}")
        self.assertEqual(canonical_symbol_key(r"\mathbb P_{ij}"), "P_{ij}")

    def test_dependency_canonical_normalizes_unbraced_accent_macros(self):
        self.assertEqual(canonical_symbol_key(r"\bar\imath"), r"\overline{\imath}")
        self.assertEqual(canonical_symbol_key(r"\bar{\imath}"), r"\overline{\imath}")
        self.assertEqual(canonical_symbol_key(r"\widehat p_t"), r"\hat{p}_t")
        self.assertEqual(canonical_symbol_key(r"\widehat{p}_{t}"), r"\hat{p}_t")

    def test_unbraced_style_macros_do_not_emit_wrapper_symbols(self):
        result = extract_symbols(r"\boldsymbol \mu=\mathbf V+\mathbf x")
        used = {item["symbol"] for item in result["symbols_used"]}
        defined = {item["symbol"] for item in result["symbols_defined"]}

        self.assertNotIn(r"\boldsymbol", used)
        self.assertNotIn(r"\mathbf", used)
        self.assertNotIn(r"\mu", used)
        self.assertIn(r"\boldsymbol{\mu}", used)
        self.assertIn(r"\boldsymbol{\mu}", defined)
        self.assertIn(r"\mathbf{V}", used)
        self.assertIn(r"\mathbf{x}", used)

    def test_alignment_markers_are_not_part_of_symbols(self):
        result = extract_symbols(r"\begin{align*} R_{z}&=\overline{z}'-\overline{z} \end{align*}")
        used = {item["symbol"] for item in result["symbols_used"]}
        defined = {item["symbol"] for item in result["symbols_defined"]}

        self.assertIn("R_{z}", used)
        self.assertIn("R_{z}", defined)
        self.assertNotIn("R_{z}&", used)
        self.assertNotIn("R_{z}&", defined)

    def test_lhs_function_call_defines_only_function_head(self):
        result = extract_symbols(r"\varphi(x,t,p)=p(1-p)x+t")
        used = {item["symbol"] for item in result["symbols_used"]}
        defined = {item["symbol"] for item in result["symbols_defined"]}

        self.assertEqual(defined, {r"\varphi"})
        self.assertIn("x", used)
        self.assertIn("t", used)
        self.assertIn("p", used)

        simple = extract_symbols(r"m(x)=x^2")
        self.assertEqual({item["symbol"] for item in simple["symbols_defined"]}, {"m"})
        self.assertIn("x", {item["symbol"] for item in simple["symbols_used"]})

    def test_expression_lhs_does_not_define_component_symbols(self):
        result = extract_symbols(
            r"\begin{align*}\sum_{i}\Delta q_{i}z_{i}&=\sum_{i}\left(w_{i}q_{i}-q_{i}\right)z_{i}\end{align*}"
        )
        defined = {item["symbol"] for item in result["symbols_defined"]}

        self.assertEqual(defined, set())

    def test_relation_without_definition_lhs_does_not_define_prose_fragments(self):
        distribution = extract_symbols(r"\frac{s}{s_{0}}\sim Beta(2,m/2)\quad for\quad0<s<s_{0}")
        approximation = extract_symbols(r"\frac{H_{h}}{H_{0}}\simeq1-p(0)^{2c/s}\quad for\quad c/s\ll1")
        where_relation = extract_symbols(
            r"\begin{align*}\gamma_{i,j}\sim N(\mu_{\gamma,i},\sigma_w^2),\quad{\rm where}\quad\mu_{\gamma,i}\sim N(\mu_{\gamma},\sigma_\gamma^2)\end{align*}"
        )

        self.assertEqual({item["symbol"] for item in distribution["symbols_defined"]}, set())
        self.assertEqual({item["symbol"] for item in approximation["symbols_defined"]}, set())
        self.assertEqual({item["symbol"] for item in where_relation["symbols_defined"]}, set())

    def test_operator_lhs_defines_only_single_argument_symbol(self):
        single = extract_symbols(r"E(t)=-\frac{4Np\ln(p)}{1-p}")
        compound = extract_symbols(
            r"E(w_{i}\overline{\delta}_{i})=\sigma(w_{i},\overline{\delta}_{i})+E(\overline{\delta}_{i})"
        )

        self.assertEqual({item["symbol"] for item in single["symbols_defined"]}, {"t"})
        self.assertEqual({item["symbol"] for item in compound["symbols_defined"]}, set())

    def test_nested_compound_lhs_is_preserved_as_atomic_symbol(self):
        result = extract_symbols(r"\begin{aligned}R_{A_{W}}&=\sigma(w_{i},A_{i}+\bar{\delta}_{i})\end{aligned}")
        used = {item["symbol"] for item in result["symbols_used"]}
        defined = {item["symbol"] for item in result["symbols_defined"]}

        self.assertIn("R_{A_{W}}", used)
        self.assertEqual(defined, {"R_{A_{W}}"})
        self.assertNotIn("R", used)
        self.assertNotIn("A_{W}", used)

    def test_nested_style_scripts_are_preserved_as_outer_symbols(self):
        result = extract_symbols(r"\beta_{\overline{{z}}|z}=x+e_{\overline{{z}},i}")
        used = {item["symbol"] for item in result["symbols_used"]}
        defined = {item["symbol"] for item in result["symbols_defined"]}

        self.assertEqual(defined, {r"\beta_{\overline{z}|z}"})
        self.assertIn(r"e_{\overline{z},i}", used)
        self.assertNotIn(r"\overline{z}", used)

    def test_array_alignment_spec_does_not_emit_letter_symbols(self):
        result = extract_symbols(
            r"\begin{array}{r l}{\overline{{z}}_{i}=\mu+\beta_{\overline{{z}}|z}z_{i}+e_{\overline{{z}},i}}\end{array}"
        )
        used = {item["symbol"] for item in result["symbols_used"]}

        self.assertNotIn("l", used)
        self.assertNotIn("r", used)
        self.assertIn(r"\beta_{\overline{z}|z}", used)

    def test_typeset_prose_words_do_not_emit_letter_symbols(self):
        result = extract_symbols(r"\begin{array}{ll} a_k=b_k, & \mathrm{for}\ k\ge 3 \end{array}")
        used = {item["symbol"] for item in result["symbols_used"]}
        defined = {item["symbol"] for item in result["symbols_defined"]}

        self.assertIn("a_k", defined)
        self.assertNotIn("f", used)
        self.assertNotIn("o", used)
        self.assertNotIn("r", used)

    def test_alphabetic_subscript_words_do_not_emit_letter_fragments(self):
        result = extract_symbols(r"n_{e,Cheverud}=n\left(1-\frac{(n-1)\sigma^{2}(\lambda)}{n^{2}}\right)")
        used = {item["symbol"] for item in result["symbols_used"]}
        defined = {item["symbol"] for item in result["symbols_defined"]}

        self.assertIn("n_{e,Cheverud}", defined)
        for fragment in {"C", "d", "e", "h", "r", "u", "v"}:
            self.assertNotIn(fragment, used)
            self.assertNotIn(fragment, defined)


class DependencyBuilderTest(unittest.TestCase):
    def test_family_candidates_are_ambiguous_not_prerequisites(self):
        formulas = [
            make_formula("formula_1.1", "1.1", r"x=1", 1),
            make_formula("formula_1.2", "1.2", r"y=1", 2),
            make_formula("formula_1.3", "1.3", r"z=1", 3),
            make_formula("formula_1.4", "1.4", r"G=1", 4),
        ]
        set_formula_defined_symbol(formulas[0], synthetic_symbol("metric_A", "metric"))
        set_formula_defined_symbol(formulas[1], synthetic_symbol("metric_B", "metric"))
        set_formula_defined_symbol(formulas[2], synthetic_symbol("metric_C", "metric"))
        set_formula_used_symbol(formulas[3], synthetic_symbol("metric_D", "metric"))
        symbol_index, senses = register_formula_senses(formulas)
        dependencies, ambiguous = build_dependencies_for_chapter(
            "chapter1",
            formulas,
            symbol_index,
            senses,
            {},
            {},
            {formula["raw_id"]: formula for formula in formulas},
        )
        target_dependency = next(item for item in dependencies if item["dependent_id"] == "formula_1.4")

        self.assertFalse(
            any(prereq.get("edge_evidence") == "family_candidate" for prereq in target_dependency["prerequisites"])
        )
        self.assertTrue(any(entry["symbol"] == "metric_D" and entry["edge_evidence"] == "family_candidate" for entry in ambiguous))

    def test_low_precision_family_candidate_is_suppressed(self):
        formulas = [
            make_formula("formula_6.2b", "6.2b", r"q_{i}^{\prime}=q_i w_i", 1, "chapter6", 6),
            make_formula("formula_6.5a", "6.5a", r"Y=q_i+1", 2, "chapter6", 6),
        ]
        symbol_index, senses = register_formula_senses(formulas)
        dependencies, ambiguous = build_dependencies_for_chapter(
            "chapter6",
            formulas,
            symbol_index,
            senses,
            {},
            {},
            {formula["raw_id"]: formula for formula in formulas},
        )
        target_dependency = next(item for item in dependencies if item["dependent_id"] == "formula_6.5a")

        self.assertEqual(target_dependency["prerequisites"], [])
        self.assertFalse(any(entry["symbol"] == "q_i" and entry["edge_evidence"] == "family_candidate" for entry in ambiguous))

    def test_sigma_variance_family_candidates_require_same_subject(self):
        formulas = [
            make_formula("formula_22.1", "22.1", r"\sigma_z^2=x", 1, "chapter22", 22),
            make_formula("formula_22.2", "22.2", r"\sigma^2=y", 2, "chapter22", 22),
            make_formula("formula_22.3", "22.3", r"\sigma^2(A_s)=y", 3, "chapter22", 22),
            make_formula("formula_22.4", "22.4", r"\sigma^2(A_d)=y", 4, "chapter22", 22),
            make_formula("formula_22.5", "22.5", r"Y=\sigma^2(A_d)+1", 5, "chapter22", 22),
        ]
        set_formula_defined_symbol(formulas[2], synthetic_symbol(r"\sigma^2(A_s)", r"\sigma_var", base=r"\sigma", superscript="2"))
        set_formula_defined_symbol(formulas[3], synthetic_symbol(r"\sigma^2(A_d)", r"\sigma_var", base=r"\sigma", superscript="2"))
        symbol_index, senses = register_formula_senses(formulas)
        dependencies, ambiguous = build_dependencies_for_chapter(
            "chapter22",
            formulas,
            symbol_index,
            senses,
            {},
            {},
            {formula["raw_id"]: formula for formula in formulas},
        )
        target_dependency = next(item for item in dependencies if item["dependent_id"] == "formula_22.5")

        self.assertTrue(
            any(
                prereq.get("target_id") == "formula_22.4"
                and prereq.get("via_symbol") == r"\sigma^2(A_d)"
                and prereq.get("edge_status") == "accepted"
                for prereq in target_dependency["prerequisites"]
            )
        )
        self.assertFalse(any(entry["symbol"] == r"\sigma^2(A_d)" for entry in ambiguous))

    def test_exact_and_canonical_edges_remain_accepted(self):
        formulas = [
            make_formula("formula_1.1", "1.1", r"\bar{t}_c=x", 1),
            make_formula("formula_1.2", "1.2", r"z=\overline{t}_c+1", 2),
        ]
        symbol_index, senses = register_formula_senses(formulas)
        dependencies, _ambiguous = build_dependencies_for_chapter(
            "chapter1",
            formulas,
            symbol_index,
            senses,
            {},
            {},
            {formula["raw_id"]: formula for formula in formulas},
        )
        target_dependency = next(item for item in dependencies if item["dependent_id"] == "formula_1.2")

        self.assertEqual(target_dependency["prerequisites"][0]["target_id"], "formula_1.1")
        self.assertEqual(target_dependency["prerequisites"][0]["edge_status"], "accepted")
        self.assertEqual(target_dependency["prerequisites"][0]["edge_evidence"], "canonical_match")

    def test_explicit_reference_is_upgraded_when_same_target_has_symbol_match(self):
        formulas = [
            make_formula("formula_14.3a", "14.3a", r"\bar\imath=x", 1, "chapter14", 14),
            make_formula("formula_14.3b", "14.3b", r"\bar{\imath}=y", 2, "chapter14", 14),
        ]
        formulas[1]["context_text"] = "Equation 14.3a can be approximated by this expression."
        symbol_index, senses = register_formula_senses(formulas)
        dependencies, _ambiguous = build_dependencies_for_chapter(
            "chapter14",
            formulas,
            symbol_index,
            senses,
            {},
            {},
            {formula["raw_id"]: formula for formula in formulas},
        )
        target_dependency = next(item for item in dependencies if item["dependent_id"] == "formula_14.3b")

        self.assertEqual(len(target_dependency["prerequisites"]), 1)
        self.assertEqual(target_dependency["prerequisites"][0]["target_id"], "formula_14.3a")
        self.assertIn(target_dependency["prerequisites"][0]["edge_evidence"], {"exact_match", "canonical_match"})
        self.assertEqual(target_dependency["prerequisites"][0]["via_symbol"], r"\bar{\imath}")

    def test_alignment_markers_do_not_break_symbol_dependencies(self):
        formulas = [
            make_formula("formula_6.4", "6.4", r"\begin{align*} R_{z}&=\overline{z}'-\overline{z} \end{align*}", 1, "chapter6", 6),
            make_formula("formula_6.6", "6.6", r"Y=R_z+1", 2, "chapter6", 6),
        ]
        symbol_index, senses = register_formula_senses(formulas)
        dependencies, _ambiguous = build_dependencies_for_chapter(
            "chapter6",
            formulas,
            symbol_index,
            senses,
            {},
            {},
            {formula["raw_id"]: formula for formula in formulas},
        )
        target_dependency = next(item for item in dependencies if item["dependent_id"] == "formula_6.6")

        self.assertEqual(senses["formula_6.4::R_{z}"]["canonical_latex"], "R_z")
        self.assertTrue(
            any(
                prereq.get("target_id") == "formula_6.4"
                and prereq.get("via_symbol") == "R_z"
                and prereq.get("edge_status") == "accepted"
                for prereq in target_dependency["prerequisites"]
            )
        )

    def test_fonted_matrix_symbol_can_match_unfonted_family_definition(self):
        formulas = [
            make_formula("formula_2.1", "2.1", r"P_{ij}=x", 1, "chapter2", 2),
            make_formula("formula_2.2a", "2.2a", r"\mathbf{x}(t+1)=\mathbf{x}(t)\mathbf{P}", 2, "chapter2", 2),
        ]
        symbol_index, senses = register_formula_senses(formulas)
        clusters, sense_to_cluster = build_symbol_sense_clusters(senses, formulas)
        dependencies, ambiguous = build_dependencies_for_chapter(
            "chapter2",
            formulas,
            symbol_index,
            senses,
            {},
            {},
            {formula["raw_id"]: formula for formula in formulas},
            sense_to_cluster,
        )
        target_dependency = next(item for item in dependencies if item["dependent_id"] == "formula_2.2a")

        self.assertTrue(
            any(
                prereq.get("target_id") == "formula_2.1"
                and prereq.get("via_symbol") == r"\mathbf{P}"
                and prereq.get("edge_evidence") == "canonical_match"
                and prereq.get("canonical_sense_id") == sense_to_cluster["formula_2.1::P_{ij}"]
                for prereq in target_dependency["prerequisites"]
            )
        )
        self.assertFalse(any(entry.get("symbol") == r"\mathbf{P}" for entry in ambiguous))
        payload = build_chapter_dependency("chapter2", formulas, dependencies, symbol_index, "now", ambiguous, clusters)
        self.assertIn("symbol_sense_clusters", payload)

    def test_same_subsection_canonical_senses_are_clustered(self):
        formulas = [
            make_formula("formula_2.3", "2.3", r"f_{t}=x", 1, "chapter2", 2),
            make_formula("formula_2.4a", "2.4a", r"f_t=f_{t}+1", 2, "chapter2", 2),
            make_formula("formula_2.10", "2.10", r"f_t=y", 3, "chapter2", 2),
        ]
        formulas[0]["subsection"] = "Loss of heterozygosity"
        formulas[1]["subsection"] = "Loss of heterozygosity"
        formulas[2]["subsection"] = "Fixation time"
        _symbol_index, senses = register_formula_senses(formulas)
        clusters, sense_to_cluster = build_symbol_sense_clusters(senses, formulas)
        ft_clusters = [cluster for cluster in clusters if cluster["canonical_symbol"] == "f_t"]

        self.assertEqual(len(ft_clusters), 2)
        same_section = next(cluster for cluster in ft_clusters if cluster["subsection"] == "Loss of heterozygosity")
        other_section = next(cluster for cluster in ft_clusters if cluster["subsection"] == "Fixation time")
        self.assertEqual(
            same_section["member_sense_ids"],
            ["formula_2.3::f_{t}", "formula_2.4a::f_t"],
        )
        self.assertEqual(other_section["member_sense_ids"], ["formula_2.10::f_t"])
        self.assertEqual(sense_to_cluster["formula_2.3::f_{t}"], sense_to_cluster["formula_2.4a::f_t"])
        self.assertNotEqual(sense_to_cluster["formula_2.3::f_{t}"], sense_to_cluster["formula_2.10::f_t"])

    def test_core_popgen_atomic_symbols_are_not_stoplisted(self):
        for symbol in ("N", "p", "q", "w", "z", "R", "S", "h", r"\mu", r"\sigma"):
            self.assertFalse(is_stoplisted_symbol(symbol), symbol)
        for symbol in ("i", "j", "t", "c"):
            self.assertTrue(is_stoplisted_symbol(symbol), symbol)

    def test_core_response_symbols_build_same_chapter_edges(self):
        formulas = [
            make_formula("formula_15.1", "15.1", r"R=hS", 1, "chapter15", 15),
            make_formula("formula_15.2", "15.2", r"Y=R+S+h", 2, "chapter15", 15),
        ]
        symbol_index, senses = register_formula_senses(formulas)
        dependencies, _ambiguous = build_dependencies_for_chapter(
            "chapter15",
            formulas,
            symbol_index,
            senses,
            {},
            {},
            {formula["raw_id"]: formula for formula in formulas},
        )
        target_dependency = next(item for item in dependencies if item["dependent_id"] == "formula_15.2")

        self.assertTrue(
            any(prereq.get("target_id") == "formula_15.1" and prereq.get("via_symbol") == "R" for prereq in target_dependency["prerequisites"])
        )

    def test_compound_group_edges_are_context_not_main_prerequisites(self):
        formulas = [
            make_formula("formula_1.1a", "1.1a", r"x=a+b", 1),
            make_formula("formula_1.1b", "1.1b", r"y=c+d", 2),
        ]
        symbol_index, senses = register_formula_senses(formulas)
        dependencies, _ambiguous = build_dependencies_for_chapter(
            "chapter1",
            formulas,
            symbol_index,
            senses,
            {},
            {},
            {formula["raw_id"]: formula for formula in formulas},
        )
        target_dependency = next(item for item in dependencies if item["dependent_id"] == "formula_1.1b")

        self.assertEqual(edge_status(EDGE_COMPOUND), "context")
        self.assertFalse(any(prereq.get("edge_evidence") == EDGE_COMPOUND for prereq in target_dependency["prerequisites"]))

    def test_cross_chapter_lookup_is_disabled_for_now(self):
        chapter1_formulas = [make_formula("formula_1.1", "1.1", r"w_i=W_i/\overline{W}", 1, "chapter1", 1)]
        chapter2_formulas = [make_formula("formula_2.1", "2.1", r"R=w_i+1", 1, "chapter2", 2)]
        chapter1_index, chapter1_senses = register_formula_senses(chapter1_formulas)
        chapter2_index, chapter2_senses = register_formula_senses(chapter2_formulas)
        global_index, global_senses = build_global_symbol_index({"chapter1": chapter1_senses, "chapter2": chapter2_senses})

        dependencies, ambiguous = build_dependencies_for_chapter(
            "chapter2",
            chapter2_formulas,
            chapter2_index,
            chapter2_senses,
            global_index,
            global_senses,
            {formula["raw_id"]: formula for formula in chapter1_formulas + chapter2_formulas},
        )
        target_dependency = next(item for item in dependencies if item["dependent_id"] == "formula_2.1")

        self.assertFalse(any(prereq.get("target_id") == "formula_1.1" for prereq in target_dependency["prerequisites"]))
        self.assertFalse(any(entry["symbol"] == "w_i" and entry["edge_evidence"] == "exact_match" for entry in ambiguous))

    def test_cross_chapter_explicit_references_are_disabled_for_now(self):
        chapter1_formulas = [make_formula("formula_1.1", "1.1", r"z=x", 1, "chapter1", 1)]
        chapter2_formulas = [make_formula("formula_2.1", "2.1", r"y=z+1", 1, "chapter2", 2)]
        chapter2_formulas[0]["context_text"] = "This follows from Equation 1.1."
        chapter2_index, chapter2_senses = register_formula_senses(chapter2_formulas)
        dependencies, _ambiguous = build_dependencies_for_chapter(
            "chapter2",
            chapter2_formulas,
            chapter2_index,
            chapter2_senses,
            {},
            {},
            {formula["raw_id"]: formula for formula in chapter1_formulas + chapter2_formulas},
        )
        target_dependency = next(item for item in dependencies if item["dependent_id"] == "formula_2.1")

        self.assertFalse(any(prereq.get("cross_chapter") for prereq in target_dependency["prerequisites"]))

    def test_variable_definition_requires_definition_language(self):
        formula = make_formula("formula_1.1", "1.1", r"Y=N_e+w", 1)
        formula["context_text"] = (
            "The recursion uses population size terms, where N_e is the effective population size. "
            "This is the trap sentence. w is where."
        )

        text_defined = extract_chapter_text_defined_symbols([formula])

        self.assertIn("n", text_defined)
        self.assertNotIn("s", text_defined)
        self.assertNotIn("w", text_defined)
        self.assertTrue(should_keep_variable_definition("N_e", text_defined))
        self.assertFalse(should_keep_variable_definition("w", text_defined))
        self.assertEqual(variable_definition_text("N_e", formula), ("the effective population size", "nearby_text:where_definition"))
        self.assertIsNone(variable_definition_text("w", formula))


def make_formula(
    formula_id: str,
    raw_id: str,
    latex: str,
    position: int,
    chapter_id: str = "chapter1",
    chapter: int = 1,
):
    extracted = extract_symbols(latex)
    return {
        "id": formula_id,
        "raw_id": raw_id,
        "latex": latex,
        "label": f"Formula {raw_id}",
        "chapter_id": chapter_id,
        "chapter": chapter,
        "section": "Synthetic test",
        "subsection": "Synthetic test",
        "position": position,
        "context_text": f"Teacher text for {raw_id}.",
        "source_chunk_id": f"test_{raw_id}",
        "symbols_used_detailed": extracted["symbols_used_detailed"],
        "symbols_defined_detailed": extracted["symbols_defined_detailed"],
        "symbols_used": [item["symbol"] for item in extracted["symbols_used"]],
        "symbols_defined": [item["symbol"] for item in extracted["symbols_defined"]],
    }


def synthetic_symbol(
    symbol: str,
    family: str,
    *,
    base: str | None = None,
    subscript: str | None = None,
    superscript: str = "",
) -> dict[str, str]:
    parsed_base, _, parsed_subscript = symbol.partition("_")
    return {
        "symbol": symbol,
        "canonical_latex": symbol,
        "exact_key": symbol,
        "family_key": family,
        "role": "parameter" if (subscript if subscript is not None else parsed_subscript) else "symbol",
        "base": base if base is not None else parsed_base,
        "subscript": subscript if subscript is not None else parsed_subscript,
        "superscript": superscript,
        "accent": "",
        "occurrence_context": "formula",
    }


def set_formula_defined_symbol(formula: dict[str, object], symbol: dict[str, str]) -> None:
    formula["symbols_defined_detailed"] = [symbol]
    formula["symbols_defined"] = [symbol["symbol"]]
    formula["symbols_used_detailed"] = [symbol]
    formula["symbols_used"] = [symbol["symbol"]]


def set_formula_used_symbol(formula: dict[str, object], symbol: dict[str, str]) -> None:
    formula["symbols_defined_detailed"] = []
    formula["symbols_defined"] = []
    formula["symbols_used_detailed"] = [symbol]
    formula["symbols_used"] = [symbol["symbol"]]


if __name__ == "__main__":
    unittest.main()
