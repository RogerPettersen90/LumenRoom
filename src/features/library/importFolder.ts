import { useUiStore } from "@/store/uiStore";

/** Open the Import dialog (source / Add-Copy-Move / destination). */
export async function importFolder(): Promise<void> {
  useUiStore.getState().setImportOpen(true);
}
