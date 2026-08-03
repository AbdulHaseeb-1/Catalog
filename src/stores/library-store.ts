import { create } from 'zustand';

import * as repo from '@/db/repository';
import { reportError, toMessage, withTimeout } from '@/lib/errors';
import { cleanupLegacyStorage } from '@/services/legacy-cleanup';
import { purgeExpiredBin } from '@/services/storage-service';
import {
  deleteImageFile,
  deleteImageFiles,
  saveProductImage,
} from '@/services/image-service';
import {
  DEFAULT_EXPORT_SETTINGS,
  EMPTY_BRAND_CONTACT,
  type BrandContact,
  type Company,
  type CompanyListItem,
  type ExportSettings,
  type Formula,
  type FormulaListItem,
  type LayoutCrops,
  type Product,
  type ProductWithRefs,
  type Rotation,
} from '@/types/models';

type Status = 'idle' | 'loading' | 'ready' | 'error';

interface LibraryState {
  status: Status;
  error: string | null;
  companies: CompanyListItem[];
  formulas: FormulaListItem[];
  products: ProductWithRefs[];
  exportSettings: ExportSettings;
  /** Your own details, printed at the foot of every catalog page. */
  brandContact: BrandContact;
  /** True while an image is being imported or cropped. */
  busy: boolean;

  hydrate: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Clear a non-fatal error banner without re-reading the database. */
  clearError: () => void;

  addCompany: (input: { name: string; address?: string; phone?: string }) => Promise<Company>;
  editCompany: (
    id: string,
    patch: { name?: string; address?: string; phone?: string }
  ) => Promise<void>;
  removeCompany: (id: string) => Promise<void>;

  addFormula: (name: string) => Promise<Formula>;
  renameFormula: (id: string, name: string) => Promise<void>;
  removeFormula: (id: string) => Promise<void>;

  addProduct: (input: {
    companyId: string;
    formulaId: string;
    sourceUri: string;
    /** Framing per layout, as fractions of the picked image. */
    crops?: LayoutCrops;
    rotation?: Rotation;
    /** Size of an already-normalised import, to skip re-encoding it. */
    sourceSize?: { width: number; height: number } | null;
  }) => Promise<Product>;
  /**
   * Import a batch under one company. A single bad photo is recorded and
   * skipped rather than abandoning the rest of the run.
   */
  addProducts: (input: {
    companyId: string;
    items: {
      sourceUri: string;
      formulaId: string;
      crops?: LayoutCrops;
      rotation?: Rotation;
      /** Size of an already-normalised import, to skip re-encoding it. */
      sourceSize?: { width: number; height: number } | null;
    }[];
    onProgress?: (done: number, total: number) => void;
  }) => Promise<{ added: number; failures: string[] }>;
  /**
   * Company, formula, photo and framing in one write. Re-framing alone touches
   * no pixels — only the stored rect changes.
   */
  editProduct: (
    id: string,
    patch: {
      companyId?: string;
      formulaId?: string;
      sourceUri?: string;
      crops?: LayoutCrops;
      /**
       * Measured size of the image the crop was drawn on. Backfills rows saved
       * before crops existed, which have no dimensions and so could not
       * otherwise turn a crop back into pixels.
       */
      sourceSize?: { width: number; height: number } | null;
      rotation?: Rotation;
    }
  ) => Promise<void>;
  /**
   * Stamp framing onto many products. Pack shots for a company come off
   * the same rig, so rects that suit one usually suit the range.
   */
  applyFramingTo: (
    ids: string[],
    framing: { crops: LayoutCrops; rotation?: Rotation }
  ) => Promise<number>;
  /** Clone a product (same photo, framing, company & formula). */
  duplicateProduct: (id: string) => Promise<Product>;
  /** Soft delete — reversible with `undoRemoveProducts`. */
  removeProduct: (id: string) => Promise<void>;
  undoRemoveProducts: (ids: string[]) => Promise<number>;
  /** Fold one reference into another, moving its products across. */
  mergeCompanies: (fromId: string, intoId: string) => Promise<number>;
  mergeFormulas: (fromId: string, intoId: string) => Promise<number>;
  /** Persist a hand-picked order for one company's products. */
  reorderCompanyProducts: (companyId: string, orderedIds: string[]) => Promise<void>;

  setExportSettings: (patch: Partial<ExportSettings>) => Promise<void>;
  setBrandContact: (contact: BrandContact) => Promise<void>;
}

async function loadAll() {
  const [companies, formulas, products] = await Promise.all([
    repo.listCompanies(),
    repo.listFormulas(),
    repo.listProducts({ order: 'recent' }),
  ]);
  return { companies, formulas, products };
}

/* ----------------------------------------------------------- targeted sync */

/**
 * Writes used to end with a full reload of all three tables. That is three
 * table scans and every product back into memory for a one-row change, which
 * made importing a batch of photos quadratic. These helpers re-read only the
 * rows a write can actually have moved.
 */

function unique(values: (string | undefined | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => !!v))];
}

/** Replace a product in place, or insert it at the head of the recent feed. */
function upsertProduct(
  list: ProductWithRefs[],
  product: ProductWithRefs
): ProductWithRefs[] {
  const index = list.findIndex((p) => p.id === product.id);
  if (index === -1) return [product, ...list];
  const next = list.slice();
  next[index] = product;
  return next;
}

function sortByName<T extends { name: string }>(list: T[]): T[] {
  return list.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

function replaceOrInsert<T extends { id: string; name: string }>(list: T[], item: T): T[] {
  const index = list.findIndex((entry) => entry.id === item.id);
  if (index === -1) return sortByName([...list, item]);
  const next = list.slice();
  next[index] = item;
  return sortByName(next);
}

/**
 * Re-read the reference rows whose derived counts a product write can have
 * changed, dropping any that no longer exist.
 */
async function syncRefs(
  state: { companies: CompanyListItem[]; formulas: FormulaListItem[] },
  companyIds: (string | undefined | null)[],
  formulaIds: (string | undefined | null)[]
): Promise<{ companies: CompanyListItem[]; formulas: FormulaListItem[] }> {
  const [companyRows, formulaRows] = await Promise.all([
    Promise.all(unique(companyIds).map((id) => repo.getCompanyListItem(id))),
    Promise.all(unique(formulaIds).map((id) => repo.getFormulaListItem(id))),
  ]);

  let companies = state.companies;
  for (const row of companyRows) {
    if (row) companies = replaceOrInsert(companies, row);
  }
  let formulas = state.formulas;
  for (const row of formulaRows) {
    if (row) formulas = replaceOrInsert(formulas, row);
  }
  return { companies, formulas };
}

const LEGACY_CLEANUP_FLAG = 'legacy_storage_cleared';

/**
 * Retire the previous photo-catalog storage. Runs after the first successful
 * hydrate, off the critical path — the app is already usable by then.
 */
async function retireLegacyStorage(): Promise<void> {
  try {
    if (await repo.isFlagSet(LEGACY_CLEANUP_FLAG)) return;
    await cleanupLegacyStorage();
    await repo.setFlag(LEGACY_CLEANUP_FLAG);
  } catch (e) {
    // Retried on the next launch — logged so it cannot fail forever unnoticed.
    reportError('library', e);
  }
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  status: 'idle',
  error: null,
  companies: [],
  formulas: [],
  products: [],
  exportSettings: DEFAULT_EXPORT_SETTINGS,
  brandContact: EMPTY_BRAND_CONTACT,
  busy: false,

  hydrate: async () => {
    set({ status: 'loading', error: null });
    try {
      // A SQLite open that never settles would otherwise leave the app on a
      // blank screen with no error to show.
      const [data, exportSettings, brandContact] = await withTimeout(
        Promise.all([loadAll(), repo.loadExportSettings(), repo.loadBrandContact()]),
        15_000,
        'Reading the product library timed out.'
      );
      set({ ...data, exportSettings, brandContact, status: 'ready' });
      void retireLegacyStorage();
      // Anything binned longer ago than the undo window is past recovering.
      void purgeExpiredBin();
    } catch (e) {
      reportError('database', e, true);
      set({
        status: 'error',
        error: toMessage(e, 'Could not open the product library.'),
      });
    }
  },

  /**
   * Re-read everything after a write. Never rejects: the write it follows has
   * already committed, so failing here means the screen is stale, not that the
   * change was lost — and a rejection would surface as "could not save".
   */
  refresh: async () => {
    try {
      set({ ...(await loadAll()), status: 'ready' });
    } catch (e) {
      reportError('library', e);
      set({ error: toMessage(e, 'Saved, but the list could not be reloaded.') });
    }
  },

  clearError: () => set({ error: null }),

  /* ---------------------------------------------------------------- companies */

  addCompany: async (input) => {
    const company = await repo.createCompany(input);
    const row = await repo.getCompanyListItem(company.id);
    if (row) set((state) => ({ companies: replaceOrInsert(state.companies, row) }));
    return company;
  },

  editCompany: async (id, patch) => {
    await repo.updateCompany(id, patch);
    const row = await repo.getCompanyListItem(id);
    if (!row) return;
    set((state) => ({
      companies: replaceOrInsert(state.companies, row),
      // The company name is denormalised onto every product for the feed.
      products: state.products.map((p) =>
        p.companyId === id ? { ...p, companyName: row.name } : p
      ),
    }));
  },

  removeCompany: async (id) => {
    const orphanedImages = await repo.deleteCompany(id);
    set((state) => ({
      companies: state.companies.filter((c) => c.id !== id),
      products: state.products.filter((p) => p.companyId !== id),
    }));
    // Formula counts drop when a company's products go with it.
    set({ formulas: await repo.listFormulas() });
    await deleteImageFiles(orphanedImages);
  },

  /* ----------------------------------------------------------------- formulas */

  addFormula: async (name) => {
    const formula = await repo.createFormula({ name });
    const row = await repo.getFormulaListItem(formula.id);
    if (row) set((state) => ({ formulas: replaceOrInsert(state.formulas, row) }));
    return formula;
  },

  renameFormula: async (id, name) => {
    await repo.renameFormula(id, name);
    const row = await repo.getFormulaListItem(id);
    if (!row) return;
    set((state) => ({
      formulas: replaceOrInsert(state.formulas, row),
      products: state.products.map((p) =>
        p.formulaId === id ? { ...p, formulaName: row.name } : p
      ),
    }));
  },

  removeFormula: async (id) => {
    const orphanedImages = await repo.deleteFormula(id);
    set((state) => ({
      formulas: state.formulas.filter((f) => f.id !== id),
      products: state.products.filter((p) => p.formulaId !== id),
    }));
    set({ companies: await repo.listCompanies() });
    await deleteImageFiles(orphanedImages);
  },

  /* ----------------------------------------------------------------- products */

  addProduct: async ({ companyId, formulaId, sourceUri, crops, rotation, sourceSize }) => {
    set({ busy: true, error: null });
    try {
      const image = await saveProductImage(sourceUri, {
        alreadyNormalized: sourceSize ?? undefined,
      });
      const created = await repo.createProduct({
        companyId,
        formulaId,
        imageUri: image.relativePath,
        width: image.width,
        height: image.height,
        // Crops are normalised, so they still describe the same regions after
        // saveProductImage has downscaled the picked file.
        crops: crops ?? {},
        rotation,
      });

      const row = await repo.getProduct(created.id);
      const state = get();
      const refs = await syncRefs(state, [companyId], [formulaId]);
      set({
        products: row ? upsertProduct(state.products, row) : state.products,
        ...refs,
        status: 'ready',
      });
      return created;
    } catch (e) {
      reportError('image', e);
      throw new Error(toMessage(e, 'Could not add that product.'));
    } finally {
      set({ busy: false });
    }
  },

  addProducts: async ({ companyId, items, onProgress }) => {
    set({ busy: true, error: null });
    const created: string[] = [];
    const failures: string[] = [];

    try {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        try {
          const image = await saveProductImage(item.sourceUri, {
            alreadyNormalized: item.sourceSize ?? undefined,
          });
          const product = await repo.createProduct({
            companyId,
            formulaId: item.formulaId,
            imageUri: image.relativePath,
            width: image.width,
            height: image.height,
            crops: item.crops ?? {},
            rotation: item.rotation,
          });
          created.push(product.id);
        } catch (e) {
          // One bad photo must not throw away the rest of the batch.
          reportError('image', e);
          failures.push(toMessage(e, 'One photo could not be saved.'));
        }
        onProgress?.(i + 1, items.length);
      }

      // A batch touches many formulas, so this is the one case where a full
      // reload genuinely costs less than re-reading each row separately.
      set({ ...(await loadAll()), status: 'ready' });
      return { added: created.length, failures };
    } finally {
      set({ busy: false });
    }
  },

  editProduct: async (id, patch) => {
    set({ busy: true, error: null });
    try {
      const existing = await repo.getProduct(id);
      if (!existing) throw new Error('Product not found.');

      let imageUri: string | undefined;
      let width: number | null | undefined;
      let height: number | null | undefined;

      if (patch.sourceUri) {
        const image = await saveProductImage(patch.sourceUri);
        imageUri = image.relativePath;
        width = image.width;
        height = image.height;
      } else if (patch.sourceSize) {
        width = patch.sourceSize.width;
        height = patch.sourceSize.height;
      }

      await repo.updateProduct(id, {
        companyId: patch.companyId,
        formulaId: patch.formulaId,
        imageUri,
        width,
        height,
        // A new photo invalidates the old framing, so replacing the image
        // always writes crops — the new ones, or empty for full frame.
        crops: patch.sourceUri
          ? (patch.crops ?? { '2x2': null, '2x3': null })
          : patch.crops,
        rotation: patch.sourceUri ? (patch.rotation ?? 0) : patch.rotation,
      });

      const row = await repo.getProduct(id);
      const state = get();
      // Both sides of a move need re-reading: the old owner loses a product
      // and the new one gains it.
      const refs = await syncRefs(
        state,
        [existing.companyId, patch.companyId],
        [existing.formulaId, patch.formulaId]
      );
      set({
        products: row
          ? state.products.map((p) => (p.id === id ? row : p))
          : state.products.filter((p) => p.id !== id),
        ...refs,
        status: 'ready',
      });

      // Only drop the old file once the row points at the new one.
      if (imageUri && existing.imageUri !== imageUri) {
        await deleteImageFile(existing.imageUri);
      }
    } catch (e) {
      reportError('image', e);
      throw new Error(toMessage(e, 'Could not save those changes.'));
    } finally {
      set({ busy: false });
    }
  },

  applyFramingTo: async (ids, framing) => {
    if (!ids.length) return 0;
    set({ busy: true, error: null });
    try {
      const count = await repo.applyFraming(ids, framing);
      const rows = await Promise.all(ids.map((id) => repo.getProduct(id)));
      const byId = new Map(rows.filter((r): r is ProductWithRefs => !!r).map((r) => [r.id, r]));
      set((state) => ({
        products: state.products.map((p) => byId.get(p.id) ?? p),
      }));
      return count;
    } catch (e) {
      reportError('library', e);
      throw new Error(toMessage(e, 'Could not apply that framing.'));
    } finally {
      set({ busy: false });
    }
  },

  duplicateProduct: async (id) => {
    set({ busy: true, error: null });
    try {
      const existing = await repo.getProduct(id);
      if (!existing) throw new Error('Product not found.');
      // Reuse the same master file — crops are independent per row.
      const created = await repo.createProduct({
        companyId: existing.companyId,
        formulaId: existing.formulaId,
        imageUri: existing.imageUri,
        width: existing.width,
        height: existing.height,
        crops: { ...existing.crops },
        rotation: existing.rotation,
      });
      const row = await repo.getProduct(created.id);
      const state = get();
      const refs = await syncRefs(state, [existing.companyId], [existing.formulaId]);
      set({
        products: row ? upsertProduct(state.products, row) : state.products,
        ...refs,
        status: 'ready',
      });
      return created;
    } catch (e) {
      reportError('library', e);
      throw new Error(toMessage(e, 'Could not duplicate that product.'));
    } finally {
      set({ busy: false });
    }
  },

  /**
   * Soft delete. The row and its image survive so `undoRemoveProducts` can put
   * them back; the bin is emptied on the next launch and by the storage sweep.
   */
  removeProduct: async (id) => {
    const state = get();
    const doomed = state.products.find((p) => p.id === id);
    // Optimistic — the grid should react immediately.
    set({ products: state.products.filter((p) => p.id !== id) });
    try {
      await repo.deleteProduct(id);
      const refs = await syncRefs(get(), [doomed?.companyId], [doomed?.formulaId]);
      set(refs);
    } catch (e) {
      set({ products: state.products });
      reportError('library', e);
      throw e;
    }
  },

  undoRemoveProducts: async (ids) => {
    if (!ids.length) return 0;
    try {
      const restored = await repo.restoreProducts(ids);
      // Restoring re-enters rows anywhere in the feed's ordering, so this is
      // the cheap case for a plain reload.
      set({ ...(await loadAll()), status: 'ready' });
      return restored;
    } catch (e) {
      reportError('library', e);
      throw new Error(toMessage(e, 'Could not restore that product.'));
    }
  },

  mergeCompanies: async (fromId, intoId) => {
    const moved = await repo.mergeCompanies(fromId, intoId);
    set({ ...(await loadAll()), status: 'ready' });
    return moved;
  },

  mergeFormulas: async (fromId, intoId) => {
    const moved = await repo.mergeFormulas(fromId, intoId);
    set({ ...(await loadAll()), status: 'ready' });
    return moved;
  },

  reorderCompanyProducts: async (companyId, orderedIds) => {
    await repo.reorderProducts(companyId, orderedIds);
    set((state) => {
      const rank = new Map(orderedIds.map((id, index) => [id, index]));
      return {
        products: state.products.map((p) =>
          rank.has(p.id) ? { ...p, sortOrder: rank.get(p.id) as number } : p
        ),
      };
    });
  },

  /* ----------------------------------------------------------------- settings */

  // Both setters apply optimistically so the control reacts instantly, then
  // roll back if the write fails — otherwise the UI shows a setting that was
  // never persisted and silently reverts on the next launch.
  setExportSettings: async (patch) => {
    const previous = get().exportSettings;
    const next = { ...previous, ...patch };
    set({ exportSettings: next });
    try {
      await repo.saveExportSettings(next);
    } catch (e) {
      set({ exportSettings: previous });
      reportError('library', e);
      throw new Error(toMessage(e, 'Could not save that export setting.'));
    }
  },

  setBrandContact: async (contact) => {
    const previous = get().brandContact;
    set({ brandContact: contact });
    try {
      await repo.saveBrandContact(contact);
    } catch (e) {
      set({ brandContact: previous });
      reportError('library', e);
      throw new Error(toMessage(e, 'Could not save your contact details.'));
    }
  },
}));

/* ------------------------------------------------------------------ selectors */

export function selectCompany(state: LibraryState, id: string | undefined) {
  return id ? state.companies.find((c) => c.id === id) : undefined;
}

export function selectFormula(state: LibraryState, id: string | undefined) {
  return id ? state.formulas.find((f) => f.id === id) : undefined;
}

export function selectProduct(state: LibraryState, id: string | undefined) {
  return id ? state.products.find((p) => p.id === id) : undefined;
}
