#!/usr/bin/env Rscript
# GLIPH2 (turboGliph) runner for the tcr-clustering GLIPH2 + Leiden engine.
#
# Builds the GLIPH2 CDR3 similarity network (clone_network.txt) from unique CDR3b (+ optional
# gene-level TRBV). The downstream Leiden partition (python) turns that network into one cluster
# per sequence. library() only — the deps come from the image, never install here.
#
# Input CSV (built by the workflow's prep step) — column names are the stable contract, kept
# INSIDE this script (same discipline the block's previous engine runner used — engine column
# names stay internal):
#   * `CDR3b` — the CDR3 amino-acid sequence (one row per unique clustering key). Always present.
#   * `TRBV`  — gene-level V gene (e.g. TRBV7-2). Present ONLY for the "+ V gene" option; when it is
#               present GLIPH2 requires the same V gene for global edges (global_vgene = TRUE,
#               gene-level, per the MILAB-6495 GLIPH2+Leiden engine decision). Absent = CDR3-only.
#
# Args:  <input.csv> <out_dir> [n_cores]
suppressMessages(library(turboGliph))

a <- commandArgs(trailingOnly = TRUE)
IN <- a[1]
OUTDIR <- a[2]
NCORES <- if (length(a) >= 3) as.integer(a[3]) else 1L

# Wall-clock timer for the runner's own log lines (turboGliph prints its own per-part cpu times;
# this is the total runner wall time, including the CSV read and the edge-dedup write).
t0 <- Sys.time()
el <- function() as.numeric(difftime(Sys.time(), t0, units = "secs"))

# Peak memory, logged to help calibrate the block's gliph-step mem limit against real datasets.
# Two measures (the runner always runs in a Linux container; both return NA elsewhere):
#   * process peak RSS  — VmHWM in /proc/self/status (kB): this R process's high-water RSS, incl.
#     turboGliph's C/C++ allocations. Misses any forked worker processes.
#   * cgroup peak        — peak memory of the WHOLE container (all processes). This is the number a
#     container mem limit must exceed, so it is the one to size the limit from. cgroup v2 then v1.
peak_rss_gb <- function() {
  st <- tryCatch(readLines("/proc/self/status", warn = FALSE), error = function(e) character(0))
  hwm <- grep("^VmHWM:", st, value = TRUE)
  if (length(hwm) == 0) return(NA_real_)
  as.numeric(gsub("[^0-9]", "", hwm)) / 1024 / 1024
}
cgroup_peak_gb <- function() {
  read_bytes <- function(p) tryCatch(as.numeric(readLines(p, warn = FALSE)[1]),
                                     error = function(e) NA_real_, warning = function(e) NA_real_)
  b <- read_bytes("/sys/fs/cgroup/memory.peak")                                  # cgroup v2 (>=5.19)
  if (is.na(b)) b <- read_bytes("/sys/fs/cgroup/memory/memory.max_usage_in_bytes")  # cgroup v1
  if (is.na(b)) NA_real_ else b / 1024^3
}

cat(sprintf("[gliph] started %s\n", format(t0, "%Y-%m-%d %H:%M:%S")))

df <- read.csv(IN, check.names = FALSE, stringsAsFactors = FALSE)
useVGene <- "TRBV" %in% names(df)

cols <- list(CDR3b = as.character(df[["CDR3b"]]))
if (useVGene) {
  cols$TRBV <- as.character(df[["TRBV"]])
}
cdr3 <- as.data.frame(cols, stringsAsFactors = FALSE)
cdr3 <- cdr3[cdr3$CDR3b != "" & !is.na(cdr3$CDR3b), , drop = FALSE]
cat(sprintf("[%.1fs] %d unique CDR3b seqs | global_vgene = %s | n_cores = %d\n", el(), nrow(cdr3), useVGene, NCORES))

res <- gliph2(
  cdr3_sequences = cdr3,
  result_folder = OUTDIR,
  n_cores = NCORES,
  global_vgene = useVGene
)

# The Leiden step needs only the two CDR3b endpoints of each connection and de-duplicates edges
# itself. gliph2() already returns the network in memory (res$connections: V1, V2, type, cluster_tag),
# so write the unique endpoint pairs straight from there — no need to re-read the clone_network.txt
# file turboGliph just wrote. Tab-separated, no header (Leiden reads the first two columns). This also
# drops the type/cluster_tag columns Leiden ignores, keeping the handed-off edge list compact.
conn <- res[["connections"]]
if (is.null(conn) || nrow(conn) == 0) {
  # No similar pairs found: an empty edge list. Leiden then mints a singleton cluster per sequence.
  file.create("clone_edges.txt")
} else {
  edges <- unique(conn[, c("V1", "V2")])
  write.table(edges, "clone_edges.txt", sep = "\t", quote = FALSE, row.names = FALSE, col.names = FALSE)
}
cat(sprintf("[gliph] ended %s | %.1fs | peak RSS %.2f GB | cgroup peak %.2f GB | results -> %s | wrote clone_edges.txt\n", format(Sys.time(), "%Y-%m-%d %H:%M:%S"), el(), peak_rss_gb(), cgroup_peak_gb(), OUTDIR))
