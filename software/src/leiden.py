#!/usr/bin/env python
"""Partition GLIPH2's similarity network with Leiden and map communities back to sequences.

Reads the GLIPH2 edge list (clone_edges.txt from step 2 -- unique CDR3b endpoint pairs) and the
seq_id<->CDR3 map (uniq.csv from the prep step), runs Leiden at a single resolution, and writes one
cluster per unique sequence -- the membership contract process_results.py consumes (seq_id =
representative clonotypeKey; integer cluster id).

Uses leidenalg.RBConfigurationVertexPartition (modularity with a resolution_parameter): higher
resolution -> more, smaller communities (splits GLIPH2's over-large clusters); resolution=1 is the
standard modularity Leiden. seed=0 makes it deterministic given the graph, so this cheap step is the
only thing that re-runs when the user tweaks resolution -- the expensive GLIPH2 network stays cached.

args: <clone_edges.txt> <uniq.csv> <output.csv> [--resolution R]
"""
import argparse
import platform
import resource
import time
from collections import defaultdict
from datetime import datetime

import pandas as pd
import igraph as ig
import leidenalg


def _peak_rss_gb() -> float:
    """This process's peak RSS. ru_maxrss is kB on Linux, bytes on macOS; the runner is Linux.
    Leiden is a single process (no forked workers), so RUSAGE_SELF captures its true peak -- same
    approach as clonotype-space's UMAP step."""
    ru = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return ru / 1024**3 if platform.system() == "Darwin" else ru / 1024**2


def main():
    p = argparse.ArgumentParser(description="Leiden partition of the GLIPH2 similarity network")
    p.add_argument("network", nargs="?", default="clone_edges.txt")
    p.add_argument("uniq", nargs="?", default="uniq.csv")
    p.add_argument("output", nargs="?", default="output.csv")
    p.add_argument("--resolution", type=float, default=1.0)
    args = p.parse_args()

    t0 = time.time()
    print(f"[leiden] started {datetime.now():%Y-%m-%d %H:%M:%S}", flush=True)

    # Build the graph from the edge list: the first two tab-separated columns are a CDR3b node pair.
    node_idx = {}

    def nid(s):
        i = node_idx.get(s)
        if i is None:
            i = node_idx[s] = len(node_idx)
        return i

    edges = []
    with open(args.network) as f:
        for line in f:
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 2 or not parts[0] or not parts[1]:
                continue
            edges.append((nid(parts[0]), nid(parts[1])))
    g = ig.Graph(n=len(node_idx), edges=edges)
    g.simplify()
    print(f"[graph] {g.vcount():,} nodes, {g.ecount():,} edges", flush=True)

    part = leidenalg.find_partition(
        g,
        leidenalg.RBConfigurationVertexPartition,
        resolution_parameter=args.resolution,
        seed=0,
    )
    idx_node = {v: k for k, v in node_idx.items()}

    # Map each network node's community back to every seq_id whose CDR3 is that node. The seq_id
    # (from prep's dedup) already encodes the full clustering key: CDR3 in CDR3-only mode, (CDR3, V)
    # in "+ V gene" mode. So a CDR3 maps to several seq_ids only in "+ V gene" mode -- when the same
    # CDR3b occurs with different V genes -- and those seq_ids share ONE network node, so they
    # co-cluster despite the differing V. turboGliph keys the network on the CDR3b string alone (the
    # V gene only constrains which edges are drawn, it is never part of a node's identity --
    # res$connections carries no V column), so identical CDR3b cannot be split by V. Verified this
    # holds even when that CDR3b has no other neighbours (turboGliph links identical CDR3b instances).
    # A known, rare v1 nuance: identical CDR3b => same cluster, even across V families.
    cdr3_to_ids = defaultdict(list)
    uniq = pd.read_csv(args.uniq, dtype=str)
    for sid, c in zip(uniq["seq_id"], uniq["CDR3 aa"]):
        cdr3_to_ids[str(c)].append(str(sid))

    assigned = {}
    for node, comm in enumerate(part.membership):
        for sid in cdr3_to_ids.get(idx_node[node], []):
            assigned[sid] = comm

    # Every unique sequence must get a cluster (one row per unique sequence). Sequences absent from
    # the network (GLIPH2 found no similar neighbour) get their own singleton cluster, mirroring
    # the block's previous-engine singleton fallback. Fresh ids start above the max community id.
    next_id = (max(assigned.values()) + 1) if assigned else 0
    rows = []
    for sid in uniq["seq_id"].astype(str):
        cl = assigned.get(sid)
        if cl is None:
            cl = next_id
            next_id += 1
        rows.append((sid, cl))
    out = pd.DataFrame(rows, columns=["seq_id", "cluster"]).drop_duplicates("seq_id")
    out.to_csv(args.output, index=False)

    # --- Summary: the granularity the resolution knob produced. "clustered" = sequences in
    # multi-member clusters (retention); "singletons" = the rest (isolated or minted). ---
    sizes = out["cluster"].value_counts()
    total = int(out.shape[0])
    multi = sizes[sizes > 1]
    n_multi = int(multi.shape[0])
    clustered = int(multi.sum())
    singletons = total - clustered
    largest = int(sizes.max()) if len(sizes) else 0
    pct = (100.0 * clustered / total) if total else 0.0
    print(
        f"[leiden] resolution={args.resolution} | {len(part):,} communities | "
        f"clusters>1={n_multi:,} | clustered={clustered:,}/{total:,} ({pct:.1f}%) | "
        f"largest={largest:,} | singletons={singletons:,}",
        flush=True,
    )
    print(
        f"[leiden] ended {datetime.now():%Y-%m-%d %H:%M:%S} | {time.time() - t0:.1f}s | "
        f"peak RSS {_peak_rss_gb():.2f} GB",
        flush=True,
    )


if __name__ == "__main__":
    main()
