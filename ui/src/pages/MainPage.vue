<script setup lang="ts">
import { PlMultiSequenceAlignment } from "@milaboratories/multi-sequence-alignment";
import strings from "@milaboratories/strings";
import type {
  AxisId,
  PColumnPredicate,
  PlRef,
  PlSelectionModel,
  PTableKey,
} from "@platforma-sdk/model";
import {
  PlAccordionSection,
  PlAgDataTableV2,
  PlAlert,
  PlBlockPage,
  PlBtnGhost,
  PlBtnGroup,
  PlDropdown,
  PlDropdownRef,
  PlLogView,
  PlMaskIcon24,
  PlNumberField,
  PlSectionSeparator,
  PlSlideModal,
  PlTabs,
  usePlDataTableSettingsV2,
} from "@platforma-sdk/ui-vue";
import { computed, reactive, ref, watch } from "vue";
import { useApp } from "../app";

const app = useApp();

const multipleSequenceAlignmentOpen = ref(false);
const clusteringLogOpen = ref(false);
// Clustering Log tabs: GLIPH2 network build (cached) vs the Leiden partition (re-runs per resolution).
const clusteringLogTab = ref<"gliph" | "leiden">("gliph");
const clusteringLogTabOptions = [
  { label: "GLIPH2", value: "gliph" as const },
  { label: "Leiden", value: "leiden" as const },
];
const settingsOpen = ref(
  app.model.data.datasetRef === undefined || app.model.data.inputSelection === undefined,
);

// Close settings once the run starts.
watch(
  () => app.model.outputs.isRunning,
  (isRunning) => {
    if (isRunning) settingsOpen.value = false;
  },
);

// MSA selection — the clusterId axis of a clicked row.
const selection = ref<PlSelectionModel>({ axesSpec: [], selectedKeys: [] });
const onRowClicked = reactive((key?: PTableKey) => {
  if (key) {
    const clusterSpec = app.model.outputs.clusterAbundanceSpec;
    if (clusterSpec === undefined) return;
    selection.value = { axesSpec: [clusterSpec.axesSpec[1]], selectedKeys: [key] };
  }
  multipleSequenceAlignmentOpen.value = true;
});

function setInput(inputRef?: PlRef) {
  app.model.data.datasetRef = inputRef;
  // The "Cluster by" choice is scoped to a dataset — clear it when the dataset changes so the
  // user re-picks against the new options (and we never carry an unresolvable ref into the run).
  app.model.data.inputSelection = undefined;
}

// "Cluster by" dropdown <-> data.inputSelection (snapshot pattern). The option value is the
// JSON-encoded InputSelection; on change we parse it back into data.inputSelection.
const clusterBy = computed(() =>
  app.model.data.inputSelection ? JSON.stringify(app.model.data.inputSelection) : undefined,
);
function onClusterByChange(value?: string) {
  app.model.data.inputSelection = value ? JSON.parse(value) : undefined;
}

// Self-heal a stale selection: if the options reload and the stored selection is no longer offered
// (dataset/upstream changed), clear it. Watch the OUTPUT (not data) — the SDK swaps the whole data
// object on server patches, which would make a data watcher clobber concurrent writes.
watch(
  () => app.model.outputs.clusterByOptions,
  (options) => {
    if (!options || options.length === 0) return;
    const cur = clusterBy.value;
    if (cur && !options.some((o) => o.value === cur)) {
      app.model.data.inputSelection = undefined;
    }
  },
  { immediate: true },
);

const tableSettings = usePlDataTableSettingsV2({
  model: () => app.model.outputs.clustersTable,
});

const centroidWeightingOptions = [
  { label: "Equal weight", value: false },
  { label: "By abundance", value: true },
];

// MSA "Sequence Columns": offer every clustering-candidate sequence, and pre-select only the
// chain(s) actually chosen for clustering. Hide what can't be a clustering input — cluster
// centroids (they live on the clusterId axis), nucleotide columns, and non-primary single-cell
// chains — so the dropdown matches the "Cluster by" options.
const isSequenceColumn: PColumnPredicate = (column) => {
  const spec = column.spec;
  if (!spec) return false;
  if (
    spec.name === "pl7.app/vdj/sequenceLength" ||
    spec.name === "pl7.app/sequenceLength" ||
    spec.name === "pl7.app/vdj/sequence/annotation"
  )
    return false;
  const axis0 = spec.axesSpec?.[0]?.name;
  if (axis0 === "pl7.app/clusterId") return false; // theoretical / reference centroids
  if (spec.domain?.["pl7.app/alphabet"] !== "aminoacid") return false; // amino-acid only (drops nt)
  if (axis0 === "pl7.app/vdj/scClonotypeKey") {
    const idx = spec.domain?.["pl7.app/vdj/scClonotypeChain/index"];
    if (idx !== undefined && idx !== "primary") return false; // primary chains only
  }
  // Available; default-select only the chain(s) chosen for clustering.
  const sel = app.model.data.inputSelection;
  const selected = sel ? [sel.sequenceRef] : [];
  return { default: selected.some((r) => r === column.columnId) };
};

// Cluster axis for the table's per-row cell button (opens the MSA).
const clusterAxis = computed<AxisId>(() => ({
  type: "String",
  name: "pl7.app/clusterId",
  domain: app.model.outputs.clusterAbundanceSpec?.axesSpec[1].domain ?? {},
}));
</script>

<template>
  <PlBlockPage
    v-model:subtitle="app.model.data.customBlockLabel"
    :subtitle-placeholder="app.model.data.defaultBlockLabel"
    title="TCR Clustering"
  >
    <template #append>
      <PlBtnGhost @click.stop="() => (clusteringLogOpen = true)">
        {{ strings.titles.logs }}
        <template #append><PlMaskIcon24 name="file-logs" /></template>
      </PlBtnGhost>
      <PlBtnGhost @click.stop="() => (settingsOpen = true)">
        {{ strings.titles.settings }}
        <template #append><PlMaskIcon24 name="settings" /></template>
      </PlBtnGhost>
    </template>

    <PlAgDataTableV2
      v-model="app.model.data.tableState"
      :settings="tableSettings"
      :not-ready-text="strings.callToActions.configureSettingsAndRun"
      :no-rows-text="strings.states.noDataAvailable"
      :show-cell-button-for-axis-id="clusterAxis"
      @cell-button-clicked="onRowClicked"
    />

    <PlSlideModal v-model="settingsOpen" close-on-outside-click shadow>
      <template #title>{{ strings.titles.settings }}</template>

      <PlDropdownRef
        v-model="app.model.data.datasetRef"
        :options="app.model.outputs.datasetOptions"
        :label="strings.titles.dataset"
        clearable
        required
        @update:model-value="setInput"
      />

      <PlDropdown
        :model-value="clusterBy"
        :options="app.model.outputs.clusterByOptions ?? []"
        label="Cluster by"
        required
        :disabled="app.model.data.datasetRef === undefined"
        @update:model-value="onClusterByChange"
      >
        <template #tooltip>
          What to cluster on.<br />
          <b>CDR3</b> clusters on the CDR3 amino-acid sequence (GLIPH2 similarity network).<br />
          <b>+ V gene</b> additionally requires the same V gene within a cluster.
        </template>
      </PlDropdown>

      <PlSectionSeparator>Centroid</PlSectionSeparator>
      <PlBtnGroup
        :model-value="app.model.data.weightByAbundance ?? false"
        label="Residue Weighting"
        :options="centroidWeightingOptions"
        compact
        @update:model-value="app.model.data.weightByAbundance = $event"
      >
        <template #tooltip>
          How each clonotype votes for the consensus residue at every alignment column (and in the
          distance / reference centroid measured against it). <b>Equal weight</b> — every clonotype
          counts once; ties break deterministically. <b>By abundance</b> — weighted by summed
          abundance, so expanded clones dominate.
        </template>
      </PlBtnGroup>
      <PlNumberField
        v-model="app.model.data.consensusThreshold"
        label="Consensus Threshold"
        :minValue="0"
        :step="0.05"
        :maxValue="1.0"
      >
        <template #tooltip>
          Minimum fraction of an alignment column's vote the winning residue must reach for the
          theoretical centroid to emit it; below the threshold the position emits <b>X</b>. The
          reference centroid (closest real member) is always reported alongside it.
        </template>
      </PlNumberField>

      <PlAlert v-if="app.model.outputs.inputState" type="warn" style="margin-top: 1rem">
        {{ "Error: the selected dataset is empty. Please choose a different dataset." }}
      </PlAlert>

      <PlAccordionSection :label="strings.titles.advancedSettings">
        <PlNumberField
          v-model="app.model.data.resolution"
          label="Leiden resolution"
          :minValue="0.1"
          :step="0.5"
          :maxValue="100"
        >
          <template #tooltip>
            Clustering granularity. Higher = finer (more, smaller clusters), splitting over-merged
            groups; lower = coarser. Recommended 1–20; default 1.
          </template>
        </PlNumberField>

        <PlSectionSeparator>Resource Allocation</PlSectionSeparator>
        <PlNumberField
          v-model="app.model.data.mem"
          label="Memory (GiB)"
          :minValue="1"
          :step="1"
          :maxValue="1012"
        >
          <template #tooltip>Memory to allocate for the clustering step.</template>
        </PlNumberField>
        <PlNumberField
          v-model="app.model.data.cpu"
          label="CPU (cores)"
          :minValue="1"
          :step="1"
          :maxValue="128"
        >
          <template #tooltip>CPU cores to allocate for the clustering step.</template>
        </PlNumberField>
      </PlAccordionSection>
    </PlSlideModal>
  </PlBlockPage>

  <!-- MSA viewer -->
  <PlSlideModal
    v-model="multipleSequenceAlignmentOpen"
    width="100%"
    :close-on-outside-click="false"
  >
    <template #title>{{ strings.titles.multipleSequenceAlignment }}</template>
    <PlMultiSequenceAlignment
      v-if="app.model.outputs.inputState === false"
      v-model="app.model.data.alignmentModel"
      :sequence-column-predicate="isSequenceColumn"
      :p-frame="app.model.outputs.msaPf"
      :selection="selection"
    />
  </PlSlideModal>

  <!-- Clustering log: GLIPH2 network build + Leiden partition, one tab each -->
  <PlSlideModal v-model="clusteringLogOpen" width="80%">
    <template #title>Clustering Log</template>
    <PlTabs v-model="clusteringLogTab" :options="clusteringLogTabOptions" />
    <PlLogView v-if="clusteringLogTab === 'gliph'" :log-handle="app.model.outputs.gliphOutput" />
    <PlLogView v-else :log-handle="app.model.outputs.leidenOutput" />
  </PlSlideModal>
</template>
