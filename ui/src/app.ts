import {
  getDefaultBlockLabel,
  platforma,
} from "@platforma-open/milaboratories.tcr-clustering.model";
import { defineAppV3 } from "@platforma-sdk/ui-vue";
import { watchEffect } from "vue";
import BubblePlotPage from "./pages/BubblePlotPage.vue";
import MainPage from "./pages/MainPage.vue";
import HistogramPage from "./pages/HistogramPage.vue";

export const sdkPlugin = defineAppV3(platforma, (app) => {
  app.model.data.customBlockLabel ??= "";

  syncDefaultBlockLabel(app.model);

  return {
    progress: () => {
      return app.model.outputs.isRunning;
    },
    routes: {
      "/": () => MainPage,
      "/bubble": () => BubblePlotPage,
      "/histogram": () => HistogramPage,
    },
  };
});

export const useApp = sdkPlugin.useApp;

type AppModel = ReturnType<typeof useApp>["model"];

function syncDefaultBlockLabel(model: AppModel) {
  // Tolerated block-label hairpin (see harness hairpin.md): derive the default label from the
  // chosen "Cluster by" option label + the Leiden resolution, unless the user set a custom label.
  watchEffect(() => {
    const sel = model.data.inputSelection;
    const selValue = sel ? JSON.stringify(sel) : undefined;
    const inputLabel = selValue
      ? (model.outputs.clusterByOptions?.find((o) => o.value === selValue)?.label ?? "")
      : "";
    model.data.defaultBlockLabel = getDefaultBlockLabel({
      inputLabel,
      resolution: model.data.resolution,
    });
  });
}
