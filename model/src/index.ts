import type { GraphMakerState } from "@milaboratories/graph-maker";
import strings from "@milaboratories/strings";
import type {
  PColumnIdAndSpec,
  PColumnSpec,
  PFrameHandle,
  PlDataTableStateV2,
  PlMultiSequenceAlignmentModel,
  PlRef,
  SUniversalPColumnId,
} from "@platforma-sdk/model";
import {
  BlockModelV3,
  DataModelBuilder,
  createPFrameForGraphs,
  createPlDataTableStateV2,
  createPlDataTableV2,
} from "@platforma-sdk/model";
export type * from "@milaboratories/helpers";

/**
 * The "Cluster by" selection, snapshotted from the chosen dropdown option (the
 * model.md snapshot pattern: `.args` is data-only, but the option refs come from
 * the result pool, so the UI writes the resolved selection into `data` on the
 * user's dropdown gesture). Single-chain only (β or α — whichever column
 * `sequenceRef` points at).
 */
export type InputSelection = {
  sequenceRef: SUniversalPColumnId;
  vGeneRef?: SUniversalPColumnId; // resolved V-gene column for the chosen chain (set only for "+ V gene")
};

export type BlockData = {
  // Block label (custom overrides default).
  defaultBlockLabel: string;
  customBlockLabel: string;

  // Input selection.
  datasetRef?: PlRef; // anchor: bulk or single-cell TCR dataset
  inputSelection?: InputSelection; // the chosen "Cluster by" option (sequence ref [+ resolved V-gene ref])

  // Engine parameter (advanced). Leiden resolution — clustering granularity: higher = more, smaller
  // clusters (splits GLIPH2's over-merged communities without changing retention). Default 1.0;
  // hard range 0.1–100 (recommended 1–20).
  resolution: number;

  // Centroid (kalign consensus, reused from clonotype-clustering).
  consensusThreshold: number; // 0–1, default 0.6: residue committed only above this column-weight fraction, else "X"
  weightByAbundance: boolean; // false = equal weight (default); true = abundance-weighted consensus/medoid

  // Resources (advanced). CPU-only in v1 — no GPU.
  mem?: number;
  cpu?: number;

  // UI-only view state — stays in data, never projected to args.
  tableState: PlDataTableStateV2;
  alignmentModel: PlMultiSequenceAlignmentModel;
  graphStateHistogram: GraphMakerState;
  graphStateBubble: GraphMakerState;
};

export function getDefaultBlockLabel(data: { inputLabel: string; resolution: number }): string {
  const parts: string[] = [];
  if (data.inputLabel) parts.push(data.inputLabel);
  parts.push(`resolution:${data.resolution}`);
  return parts.filter(Boolean).join(", ");
}

const dataModel = new DataModelBuilder().from<BlockData>("v1").init(() => ({
  defaultBlockLabel: getDefaultBlockLabel({ inputLabel: "", resolution: 1.0 }),
  customBlockLabel: "",
  resolution: 1.0,
  consensusThreshold: 0.6,
  weightByAbundance: false,
  tableState: createPlDataTableStateV2(),
  alignmentModel: {},
  graphStateBubble: {
    title: "Most abundant clusters",
    template: "bubble",
    currentTab: null,
    layersSettings: {
      bubble: {
        normalizationDirection: null,
      },
    },
  },
  graphStateHistogram: {
    title: strings.titles.histogram,
    template: "bins",
    currentTab: null,
    layersSettings: {
      bins: { fillColor: "#99e099" },
    },
    axesSettings: {
      axisY: {
        axisLabelsAngle: 90,
        scale: "log",
      },
      other: { binsCount: 30 },
    },
  },
}));

/** Strip the trailing " Primary" token from a MiXCR single-cell label ("Beta CDR3 aa Primary" -> "Beta CDR3 aa"). */
function trimPrimary(label: string): string {
  return label.replace(/\s+Primary$/i, "");
}

export const platforma = BlockModelV3.create(dataModel)

  .args((data) => {
    if (!data.datasetRef) throw new Error("Dataset is required");
    const sel = data.inputSelection;
    if (!sel) throw new Error("Choose what to cluster by");
    if (!sel.sequenceRef) throw new Error("A CDR3 column is required");

    // Gate Run on the Leiden resolution: throwing here makes the block not-runnable (Run disabled,
    // message surfaced) rather than silently clamping. The `!(… >= … && … <= …)` form also catches a
    // cleared/blank field (undefined) or NaN — a plain `< || >` would let those through as false.
    if (!(data.resolution >= 0.1 && data.resolution <= 100))
      throw new Error("Leiden resolution must be between 0.1 and 100");
    // consensusThreshold is still clamped (canonicalize so the staleness gate doesn't fire on
    // out-of-range edits the centroid step would clamp anyway).
    const consensusThreshold = Math.min(1, Math.max(0, data.consensusThreshold));

    return {
      defaultBlockLabel: data.defaultBlockLabel,
      customBlockLabel: data.customBlockLabel,
      datasetRef: data.datasetRef,
      inputSelection: sel,
      resolution: data.resolution,
      consensusThreshold,
      weightByAbundance: data.weightByAbundance,
      mem: data.mem,
      cpu: data.cpu,
    };
  })

  // Dataset picker: TCR α/β clonotype datasets (bulk + single-cell). No peptide (variantKey).
  // Only TCR α/β is offered — IG (BCR) and TCR γ/δ are dropped (this is a TCR-β/α specificity-
  // clustering block, and GLIPH2 is built for αβ). Bulk anchors are per-chain (clonotypeKey domain
  // `pl7.app/vdj/chain` = TCRAlpha/TCRBeta); single-cell anchors are per-receptor (scClonotypeKey
  // domain `pl7.app/vdj/receptor` = TCRAB).
  .output("datasetOptions", (ctx) => {
    const options = ctx.resultPool.getOptions(
      [
        {
          axes: [{ name: "pl7.app/sampleId" }, { name: "pl7.app/vdj/clonotypeKey" }],
          annotations: { "pl7.app/isAnchor": "true" },
        },
        {
          axes: [{ name: "pl7.app/sampleId" }, { name: "pl7.app/vdj/scClonotypeKey" }],
          annotations: { "pl7.app/isAnchor": "true" },
        },
      ],
      {
        // suppress the column's native label (e.g. "Number of Reads") to show only the dataset label
        label: { includeNativeLabel: false },
      },
    );

    // Bulk anchors carry the chain per clonotypeKey; keep only the TCR α/β chains.
    const TCR_AB_CHAINS = new Set(["TCRAlpha", "TCRBeta"]);

    return options.filter((opt) => {
      const keyAxis = ctx.resultPool.getPColumnSpecByRef(opt.ref)?.axesSpec[1];
      if (keyAxis === undefined) return false;
      // Exclude this block's OWN exported cluster axis from the input picker.
      if (keyAxis.domain?.["pl7.app/clustering/algorithm"] !== undefined) return false;
      // Bulk: per-chain anchor → keep only TCR α/β (drop IG, TCR γ/δ).
      if (keyAxis.name === "pl7.app/vdj/clonotypeKey") {
        return TCR_AB_CHAINS.has(keyAxis.domain?.["pl7.app/vdj/chain"] ?? "");
      }
      // Single-cell: per-receptor anchor → keep only the TCR α/β receptor (drop IG, TCR γ/δ). The
      // "Cluster by" dropdown then offers the Primary Beta / Alpha CDR3 for single-chain clustering.
      if (keyAxis.name === "pl7.app/vdj/scClonotypeKey") {
        return keyAxis.domain?.["pl7.app/vdj/receptor"] === "TCRAB";
      }
      return false;
    });
  })

  // The single "Cluster by" dropdown. Options are generated from the dataset's Primary CDR3 aa
  // columns (labelled from MiXCR, "Primary" trimmed), each also offered "+ V gene" when the
  // dataset carries V-gene columns. Single-chain only — turboGliph has no native α+β pairing, so
  // there is no "Paired" option. Each option's value is a JSON-encoded InputSelection; the UI parses
  // it into data.inputSelection on the user's gesture (snapshot pattern). The chain name is read
  // from the MiXCR LABEL, never from the scClonotypeChain slot letter (diversity-ordered: A=Beta).
  .output("clusterByOptions", (ctx) => {
    const ref = ctx.data.datasetRef;
    if (ref === undefined) return undefined;
    const dsSpec = ctx.resultPool.getPColumnSpecByRef(ref);
    if (dsSpec === undefined) return undefined;
    const isSingleCell = dsSpec.axesSpec[1].name === "pl7.app/vdj/scClonotypeKey";

    const cdr3Matcher = {
      axes: [{ anchor: "main" as const, idx: 1 }],
      name: "pl7.app/vdj/sequence",
      domain: {
        "pl7.app/vdj/feature": "CDR3",
        "pl7.app/alphabet": "aminoacid",
        // Single-cell: restrict to each chain's Primary CDR3.
        ...(isSingleCell ? { "pl7.app/vdj/scClonotypeChain/index": "primary" } : {}),
      },
    };
    const cdr3Cols = ctx.resultPool.getCanonicalOptions({ main: ref }, [cdr3Matcher], {
      ignoreMissingDomains: true,
      labelOps: { includeNativeLabel: true },
    });
    if (cdr3Cols === undefined) return undefined;

    // Resolve the V-gene column(s) so the "+ V gene" options carry the matching V-gene ref (the
    // workflow consumes it directly — no workflow-side chain matching). Single-cell: one V-gene
    // column per chain (restrict to Primary); bulk: one on the anchor. Match a V gene to a CDR3 by
    // the chain name in the MiXCR label ("Beta CDR3 aa" <-> "Beta Best V gene"; bulk: both have no
    // chain prefix → both map to "").
    const vGeneOpts = ctx.resultPool.getCanonicalOptions(
      { main: ref },
      [
        {
          axes: [{ anchor: "main" as const, idx: 1 }],
          name: "pl7.app/vdj/geneHit",
          domain: {
            "pl7.app/vdj/reference": "VGene",
            ...(isSingleCell ? { "pl7.app/vdj/scClonotypeChain/index": "primary" } : {}),
          },
        },
      ],
      { ignoreMissingDomains: true, labelOps: { includeNativeLabel: true } },
    );
    const chainOf = (label: string) =>
      (label.match(/^(Alpha|Beta|Gamma|Delta|Heavy|Light)\b/i)?.[1] ?? "").toLowerCase();
    const vGeneByChain = new Map<string, SUniversalPColumnId>();
    for (const v of vGeneOpts ?? []) vGeneByChain.set(chainOf(v.label ?? ""), v.value);

    const options: { label: string; value: string }[] = [];
    for (const c of cdr3Cols) {
      const base = trimPrimary(c.label ?? "");
      const single: InputSelection = { sequenceRef: c.value };
      options.push({ label: base, value: JSON.stringify(single) });
      const vGeneRef = vGeneByChain.get(chainOf(c.label ?? ""));
      if (vGeneRef !== undefined) {
        const withV: InputSelection = { sequenceRef: c.value, vGeneRef };
        options.push({ label: `${base} + V gene`, value: JSON.stringify(withV) });
      }
    }

    return options;
  })

  .output("isSingleCell", (ctx) => {
    if (ctx.data.datasetRef === undefined) return undefined;
    const spec = ctx.resultPool.getPColumnSpecByRef(ctx.data.datasetRef);
    if (spec === undefined) return undefined;
    return spec.axesSpec[1].name === "pl7.app/vdj/scClonotypeKey";
  })

  // Empty-input flag (the workflow emits `isEmpty`). Not-ready-safe read (getDataAsJson throws
  // mid-run on remote backends — MILAB-6318), so use the OrUndefined variant.
  .output("inputState", (ctx): boolean | undefined => {
    const inputState = ctx.outputs?.resolve("isEmpty")?.getDataAsJsonOrUndefined<unknown>();
    return typeof inputState === "boolean" ? inputState : undefined;
  })

  // Main clusters table.
  .outputWithStatus("clustersTable", (ctx) => {
    const pCols = ctx.outputs?.resolve("clustersPf")?.getPColumns();
    if (pCols === undefined) return undefined;
    return createPlDataTableV2(ctx, pCols, ctx.data.tableState);
  })

  // Clustering run logs — GLIPH2 network build (gliph stdout) and the Leiden partition (leiden
  // stdout). Shown as two tabs in the Clustering Log window.
  .output("gliphOutput", (ctx) => ctx.outputs?.resolve("gliphLog")?.getLogHandle())
  .output("leidenOutput", (ctx) => ctx.outputs?.resolve("leidenLog")?.getLogHandle())

  // MSA p-frame for the alignment viewer: the workflow's msaPf (linker + distances + sequences)
  // plus the dataset's ORIGINAL sequence columns chosen for clustering.
  .output("msaPf", (ctx): PFrameHandle | undefined => {
    const msaCols = ctx.outputs?.resolve("msaPf")?.getPColumns();
    if (!msaCols) return undefined;
    const datasetRef = ctx.data.datasetRef;
    const sel = ctx.data.inputSelection;
    if (datasetRef === undefined || sel === undefined) return createPFrameForGraphs(ctx, msaCols);
    const refs = [sel.sequenceRef];
    const seqCols = ctx.resultPool.getAnchoredPColumns(
      { main: datasetRef },
      refs.map((s) => JSON.parse(s) as never),
    );
    if (seqCols === undefined) return createPFrameForGraphs(ctx, msaCols);
    return createPFrameForGraphs(ctx, [...msaCols, ...seqCols]);
  })

  // The cluster-to-clonotype linker column id, used by the MSA viewer.
  .output("linkerColumnId", (ctx) => {
    const pCols = ctx.outputs?.resolve("msaPf")?.getPColumns();
    if (!pCols) return undefined;
    return pCols.find((p) => p.spec.annotations?.["pl7.app/isLinkerColumn"] === "true")?.id;
  })

  // Spec of the per-(sample, cluster) abundance column — drives the MSA cell-button axis.
  .output("clusterAbundanceSpec", (ctx) => {
    return ctx.outputs?.resolve("clusterAbundanceSpec")?.getDataAsJsonOrUndefined<PColumnSpec>();
  })

  // p-frame of all cluster columns, for the plots.
  .outputWithStatus("clustersPf", (ctx): PFrameHandle | undefined => {
    const pCols = ctx.outputs?.resolve("pf")?.getPColumns();
    if (pCols === undefined) return undefined;
    return createPFrameForGraphs(ctx, pCols);
  })

  // Top-clusters p-frame for the bubble plot.
  .outputWithStatus("bubblePlotPf", (ctx): PFrameHandle | undefined => {
    const pCols = ctx.outputs?.resolve("bubblePlotPf")?.getPColumns();
    if (pCols === undefined) return undefined;
    return createPFrameForGraphs(ctx, pCols);
  })

  // Pcol id+spec lists for plot defaults.
  .output("clustersPfPcols", (ctx) => {
    const pCols = ctx.outputs?.resolve("pf")?.getPColumns();
    if (pCols === undefined || pCols.length === 0) return undefined;
    return pCols.map((c) => ({ columnId: c.id, spec: c.spec }) satisfies PColumnIdAndSpec);
  })

  .output("bubblePlotPfPcols", (ctx) => {
    const pCols = ctx.outputs?.resolve("bubblePlotPf")?.getPColumns();
    if (pCols === undefined) return undefined;
    return pCols.map((c) => ({ columnId: c.id, spec: c.spec }) satisfies PColumnIdAndSpec);
  })

  .output("isRunning", (ctx) => ctx.outputs?.getIsReadyOrError() === false)

  .title(() => "TCR Clustering")

  .subtitle((ctx) => ctx.data.customBlockLabel || ctx.data.defaultBlockLabel)

  .sections((_ctx) => [
    { type: "link" as const, href: "/" as const, label: strings.titles.main },
    { type: "link" as const, href: "/bubble" as const, label: "Most Abundant Clusters" },
    { type: "link" as const, href: "/histogram" as const, label: "Cluster Size Histogram" },
  ])

  .done();
