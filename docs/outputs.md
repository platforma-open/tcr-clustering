# Outputs

The per-row input key is `clonotypeKey` (the TCR clonotype — bulk or single-cell).

`clusterId` is the cluster's **medoid** — the real clonotype whose CDR3 is closest to the cluster's consensus centre (minimum profile distance). As in the other clustering blocks, the medoid *is* the cluster id, so the reference-centroid column below is the `clusterId` member's own sequence.

Each cluster exposes, on the `clusterId` axis:

- **Reference centroid (medoid)** — `reference_centroid_sequence_0..N` (one per chain). A real observed member — the medoid — so it contains real amino acids only and is directly synthesizable. Default-visible.
- **Theoretical (consensus) centroid** — `centroid_sequence_0..N` (one per chain). The cluster's distinct members are aligned with kalign (MSA) and the centroid is the per-column consensus. The **Residue Weighting** option (`weightByAbundance`) controls the vote: **Equal weight** (default) counts every clonotype once (ties break deterministically: non-gap over gap, then alphabetically); **By abundance** weights each clonotype by its summed abundance. A column emits its winning residue only when that residue holds at least the **Consensus Threshold** (default `0.6`) of the column's weight; below that it emits `X` (IUPAC "any/unknown", a low-confidence position). May not match any observed member; emitted with table visibility `optional` (hidden by default). `X` is display-only and never enters the distance computation.

`distanceToCentroid` and `clusterRadius` come from a **profile distance** over the kalign MSA (not a flat string / Levenshtein comparison). Each member's residue in aligned column `j` is charged `1 − pⱼ(residue)`, where `pⱼ` is the column's weighted fraction for that residue under the active Residue Weighting (gap counts as a residue). A member's per-chain raw distance `Dᵢ⁽ˢ⁾` sums these costs over its aligned columns; `distanceToCentroid = min(1, Σₛ Dᵢ⁽ˢ⁾ / Σₛ max(L_cons⁽ˢ⁾, ℓᵢ⁽ˢ⁾))`, where `L_cons⁽ˢ⁾` is the number of consensus (non-gap-majority) columns and `ℓᵢ⁽ˢ⁾` the member's non-gap length. The reference-centroid medoid is the member that minimizes this distance (`argmin Dᵢ`).

```

clusterId -> Reference centroid seq (medoid: the clusterId member's real sequence, always emitted), [secondary chain sequences]

clusterId -> Theoretical centroid seq (kalign MSA consensus; table visibility optional), [secondary chain sequences]

clusterId -> cluster size (number of distinct clonotypes in the cluster)

[sampleId, clusterId] -> per-cluster abundance — one column per abundance column carried by the input (e.g. readCount, uniqueMoleculeCount), plus the corresponding fraction column

clonotypeKey -> clusterId (cluster assignment per clonotype, used for downstream linking)

[clusterId, clonotypeKey] -> 1 (isLinkerColumn=true)


Optional / per-member:

clonotypeKey -> distanceToCentroid (member profile distance to the cluster's theoretical centroid; 0–1)

clusterId -> clusterRadius (max member distanceToCentroid per cluster)

```
