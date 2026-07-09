# Overview

Groups TCR clonotypes by likely shared antigen specificity, enabling researchers to identify T cells that may recognize the same antigen. Specificity is driven mostly by the central CDR3 loop, so the block uses **GLIPH2** (via **turboGliph**) to build a CDR3 similarity network — grouping sequences that share enriched local motifs or differ by a single amino acid (global similarity), optionally restricted to the same V gene — and then partitions that network with the **Leiden** community-detection algorithm. Leiden's **resolution** parameter controls cluster granularity: higher values split larger communities into more, smaller clusters. Clustering runs on a single chain (β or α), optionally restricted to the same V gene, and results include a cluster assignment for each clonotype along with cluster-level statistics — a representative sequence, consensus centroid, distance-to-centroid, and cluster radius — visualized using bubble plots and histograms.

**Large datasets.** GLIPH2's global-similarity search scales steeply with the number of unique sequences, so beyond a few hundred thousand a single pass becomes impractical. For inputs above ~600,000 sequences, choose a **+ V gene** option: the block then clusters within each V gene independently — a large speed-up that keeps the run tractable at scale, using global similarity only (the local-motif step is skipped for these large runs).

The clustered data can be used in downstream analysis blocks such as Sequence Enrichment to analyze enrichment patterns at the cluster level across selection rounds, or Lead Selection to identify top candidates based on cluster-level scoring metrics.

GLIPH2 is developed by the Han lab (Stanford University); turboGliph is a from-scratch R reimplementation of GLIPH/GLIPH2. Leiden is provided by the `leidenalg` / `python-igraph` libraries. Please cite the following publications if used in your research:

> Huang H, Wang C, Rubelt F, Scriba TJ, Davis MM. Analyzing the Mycobacterium tuberculosis immune response by T-cell receptor clustering with GLIPH2 and genome-wide antigen screening. _Nature Biotechnology_ 2020; 38:1194–1202. [https://doi.org/10.1038/s41587-020-0505-4](https://doi.org/10.1038/s41587-020-0505-4)

> Traag VA, Waltman L, van Eck NJ. From Louvain to Leiden: guaranteeing well-connected communities. _Scientific Reports_ 2019; 9:5233. [https://doi.org/10.1038/s41598-019-41695-z](https://doi.org/10.1038/s41598-019-41695-z)

turboGliph: [https://github.com/HetzDra/turboGliph](https://github.com/HetzDra/turboGliph)
