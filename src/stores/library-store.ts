import { create } from 'zustand';

import * as repo from '@/db/repository';
import { cleanupLegacyStorage } from '@/services/legacy-cleanup';
import {
  cropProductImage,
  deleteImageFile,
  deleteImageFiles,
  saveProductImage,
  type CropRect,
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
  type Product,
  type ProductWithRefs,
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
  }) => Promise<Product>;
  editProduct: (
    id: string,
    patch: { companyId?: string; formulaId?: string; sourceUri?: string }
  ) => Promise<void>;
  cropProduct: (id: string, crop: CropRect) => Promise<void>;
  removeProduct: (id: string) => Promise<void>;
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
  } catch {
    // Retried on the next launch.
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
      const [data, exportSettings, brandContact] = await Promise.all([
        loadAll(),
        repo.loadExportSettings(),
        repo.loadBrandContact(),
      ]);
      set({ ...data, exportSettings, brandContact, status: 'ready' });
      void retireLegacyStorage();
    } catch (e) {
      set({
        status: 'error',
        error: e instanceof Error ? e.message : 'Could not open the product library.',
      });
    }
  },

  refresh: async () => {
    set(await loadAll());
  },

  /* ---------------------------------------------------------------- companies */

  addCompany: async (input) => {
    const company = await repo.createCompany(input);
    await get().refresh();
    return company;
  },

  editCompany: async (id, patch) => {
    await repo.updateCompany(id, patch);
    await get().refresh();
  },

  removeCompany: async (id) => {
    const orphanedImages = await repo.deleteCompany(id);
    await get().refresh();
    await deleteImageFiles(orphanedImages);
  },

  /* ----------------------------------------------------------------- formulas */

  addFormula: async (name) => {
    const formula = await repo.createFormula({ name });
    await get().refresh();
    return formula;
  },

  renameFormula: async (id, name) => {
    await repo.renameFormula(id, name);
    await get().refresh();
  },

  removeFormula: async (id) => {
    const orphanedImages = await repo.deleteFormula(id);
    await get().refresh();
    await deleteImageFiles(orphanedImages);
  },

  /* ----------------------------------------------------------------- products */

  addProduct: async ({ companyId, formulaId, sourceUri }) => {
    set({ busy: true, error: null });
    try {
      const image = await saveProductImage(sourceUri);
      const product = await repo.createProduct({
        companyId,
        formulaId,
        imageUri: image.relativePath,
        width: image.width,
        height: image.height,
      });
      await get().refresh();
      return product;
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
      }

      await repo.updateProduct(id, {
        companyId: patch.companyId,
        formulaId: patch.formulaId,
        imageUri,
        width,
        height,
      });
      await get().refresh();

      // Only drop the old file once the row points at the new one.
      if (imageUri && existing.imageUri !== imageUri) {
        await deleteImageFile(existing.imageUri);
      }
    } finally {
      set({ busy: false });
    }
  },

  cropProduct: async (id, crop) => {
    set({ busy: true, error: null });
    try {
      const product = await repo.getProduct(id);
      if (!product) throw new Error('Product not found.');

      const image = await cropProductImage(product.imageUri, crop);
      await repo.updateProduct(id, {
        imageUri: image.relativePath,
        width: image.width,
        height: image.height,
      });
      await get().refresh();

      if (product.imageUri !== image.relativePath) {
        await deleteImageFile(product.imageUri);
      }
    } finally {
      set({ busy: false });
    }
  },

  removeProduct: async (id) => {
    // Optimistic — the grid should react immediately.
    const previous = get().products;
    set({ products: previous.filter((p) => p.id !== id) });
    try {
      const imageUri = await repo.deleteProduct(id);
      await get().refresh();
      await deleteImageFile(imageUri);
    } catch (e) {
      set({ products: previous });
      throw e;
    }
  },

  reorderCompanyProducts: async (companyId, orderedIds) => {
    await repo.reorderProducts(companyId, orderedIds);
    await get().refresh();
  },

  /* ----------------------------------------------------------------- settings */

  setExportSettings: async (patch) => {
    const next = { ...get().exportSettings, ...patch };
    set({ exportSettings: next });
    await repo.saveExportSettings(next);
  },

  setBrandContact: async (contact) => {
    set({ brandContact: contact });
    await repo.saveBrandContact(contact);
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
