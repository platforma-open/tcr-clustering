#!/usr/bin/env python
"""Dedup the per-clonotype table to unique clustering keys and build the GLIPH2 + Leiden inputs.

Reproduces the dedup + representative->clonotype mapping the block's previous-engine runner did
in-process, minus the clustering itself (now GLIPH2 in R + Leiden in python). Reads the raw
per-clonotype table and writes three files:
  gliph_input.csv  : CDR3b [+ TRBV] -- one row per unique clustering key, for turboGliph (step 2).
  dedup_mapping.tsv: representativeKey, clonotypeKey -- one row per original clonotype; process_results
                     expands clusters back to all clonotypes with it (same format as before).
  uniq.csv         : seq_id, "CDR3 aa" -- seq_id = representative clonotypeKey; the seq_id<->CDR3 map
                     the Leiden step (step 3) uses to expand clone_network nodes back to sequences.

Input TSV (input.tsv, built by the workflow): `clonotypeKey`, `sequence_0` (primary CDR3, beta or
alpha), and OPTIONALLY `v_gene` (the "+ V gene" option -- gene-level, e.g. TRBV7-2). Paired alpha+beta
is not offered in v1, so there is no `sequence_1`.

Runs on the -clustering python runenv (polars). Dedup output is independent of CPU/threads and of the
Leiden resolution -- keeping it a separate step is what lets the expensive GLIPH2 network stay cached
across resolution tweaks.
"""
import argparse
import polars as pl


def main():
    p = argparse.ArgumentParser(description="Dedup clonotypes and build GLIPH2 + Leiden inputs")
    p.add_argument("input", nargs="?", default="input.tsv")
    p.add_argument("gliph_input", nargs="?", default="gliph_input.csv")
    p.add_argument("mapping", nargs="?", default="dedup_mapping.tsv")
    p.add_argument("uniq", nargs="?", default="uniq.csv")
    args = p.parse_args()

    # Read the raw per-clonotype table (all-string) and name the primary CDR3 column.
    df = pl.read_csv(args.input, separator="\t", infer_schema_length=0).fill_null("")
    df = df.rename({"sequence_0": "cdr3"})
    # Clustering key: CDR3 [+ V gene]. Deduping on the tuple yields GLIPH2's unique-sequence input.
    key_cols = [c for c in ("cdr3", "v_gene") if c in df.columns]

    # Dedup identical clustering-key tuples; the first clonotypeKey per tuple is the representative.
    # The mapping restores all clonotypes downstream.
    reps = df.unique(subset=key_cols, keep="first")
    (
        df.join(
            reps.select(["clonotypeKey", *key_cols]).rename({"clonotypeKey": "representativeKey"}),
            on=key_cols,
            how="inner",
        )
        .select(["representativeKey", "clonotypeKey"])
        .write_csv(args.mapping, separator="\t")
    )

    # Unique sequences, keyed by the representative clonotypeKey (= seq_id downstream).
    src = reps.select([pl.col("clonotypeKey").alias("seq_id"), *key_cols])
    n_unique = src.height
    use_vgene = "v_gene" in src.columns and (src["v_gene"].str.len_chars() > 0).any()
    print(
        f"[prep] {df.height:,} clonotypes -> {n_unique:,} unique keys | v_gene={use_vgene}",
        flush=True,
    )

    # gliph_input.csv for turboGliph: CDR3b always; TRBV only in "+ V gene" mode -- its presence is
    # how run_gliph2.R decides global_vgene. Column names are the stable contract with the R script.
    gliph_cols = [pl.col("cdr3").alias("CDR3b")]
    if use_vgene:
        gliph_cols.append(pl.col("v_gene").alias("TRBV"))
    src.select(gliph_cols).write_csv(args.gliph_input)

    # uniq.csv for the Leiden step: seq_id + CDR3 aa (clone_network nodes are CDR3b strings, so the
    # Leiden step maps node -> seq_id by CDR3).
    src.select([pl.col("seq_id"), pl.col("cdr3").alias("CDR3 aa")]).write_csv(args.uniq)

    print(f"[OK] wrote {args.gliph_input}, {args.mapping}, {args.uniq}", flush=True)


if __name__ == "__main__":
    main()
