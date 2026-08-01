import { create } from 'zustand';

import * as repo from '@/db/repository';
import {
  cropAndSaveImage,
  deleteCatalogImageFolder,
  saveImageAsset,
} from '@/services/image-service';
import type {
  Catalog,
  CatalogListItem,
  CatalogWithPhotos,
  CreateCatalogInput,
  UpdateCatalogInput,
} from '@/types/models';

type Status = 'idle' | 'loading' | 'ready' | 'error';

interface CatalogState {
  status: Status;
  error: string | null;
  catalogs: CatalogListItem[];
  activeCatalog: CatalogWithPhotos | null;
  uploading: boolean;
  hydrate: () => Promise<void>;
  refreshCatalogs: () => Promise<void>;
  loadCatalog: (id: string) => Promise<CatalogWithPhotos | null>;
  createCatalog: (input: CreateCatalogInput) => Promise<Catalog>;
  updateCatalog: (id: string, patch: UpdateCatalogInput) => Promise<Catalog>;
  deleteCatalog: (id: string) => Promise<void>;
  addPhotosFromUris: (catalogId: string, sourceUris: string[]) => Promise<number>;
  deletePhoto: (photoId: string, catalogId: string) => Promise<void>;
  deletePhotos: (photoIds: string[], catalogId: string) => Promise<void>;
  cropPhoto: (
    photoId: string,
    catalogId: string,
    crop: { originX: number; originY: number; width: number; height: number }
  ) => Promise<void>;
}

export const useCatalogStore = create<CatalogState>((set, get) => ({
  status: 'idle',
  error: null,
  catalogs: [],
  activeCatalog: null,
  uploading: false,

  hydrate: async () => {
    set({ status: 'loading', error: null });
    try {
      const catalogs = await repo.listCatalogs();
      set({ catalogs, status: 'ready' });
    } catch (e) {
      set({
        status: 'error',
        error: e instanceof Error ? e.message : 'Failed to load catalogs',
      });
    }
  },

  refreshCatalogs: async () => {
    const catalogs = await repo.listCatalogs();
    set({ catalogs });
  },

  loadCatalog: async (id) => {
    const catalog = await repo.getCatalogWithPhotos(id);
    set({ activeCatalog: catalog });
    return catalog;
  },

  createCatalog: async (input) => {
    const created = await repo.createCatalog(input);
    await get().refreshCatalogs();
    return created;
  },

  updateCatalog: async (id, patch) => {
    const updated = await repo.updateCatalog(id, patch);
    await get().refreshCatalogs();
    if (get().activeCatalog?.id === id) {
      await get().loadCatalog(id);
    }
    return updated;
  },

  deleteCatalog: async (id) => {
    await repo.deleteCatalog(id);
    await deleteCatalogImageFolder(id);
    if (get().activeCatalog?.id === id) set({ activeCatalog: null });
    await get().refreshCatalogs();
  },

  addPhotosFromUris: async (catalogId, sourceUris) => {
    if (!sourceUris.length) return 0;
    set({ uploading: true, error: null });
    try {
      const saved: { uri: string; width: number | null; height: number | null }[] = [];
      for (const source of sourceUris) {
        try {
          const asset = await saveImageAsset(source, { catalogId });
          saved.push({
            uri: asset.relativePath,
            width: asset.width,
            height: asset.height,
          });
        } catch (e) {
          console.warn('Failed to save image', source, e);
        }
      }
      if (saved.length) {
        await repo.addPhotosBatch(catalogId, saved);
        await get().loadCatalog(catalogId);
        await get().refreshCatalogs();
      }
      return saved.length;
    } finally {
      set({ uploading: false });
    }
  },

  deletePhoto: async (photoId, catalogId) => {
    // Optimistic UI — remove immediately so the grid updates
    const prev = get().activeCatalog;
    if (prev?.id === catalogId) {
      set({
        activeCatalog: {
          ...prev,
          photos: prev.photos.filter((p) => p.id !== photoId),
        },
      });
    }

    try {
      const ok = await repo.deletePhoto(photoId);
      if (!ok) {
        // Reload if nothing was deleted (stale id)
        await get().loadCatalog(catalogId);
      }
      await get().refreshCatalogs();
    } catch (e) {
      // Roll back optimistic update
      if (prev) set({ activeCatalog: prev });
      throw e;
    }
  },

  deletePhotos: async (photoIds, catalogId) => {
    const idSet = new Set(photoIds);
    const prev = get().activeCatalog;
    if (prev?.id === catalogId) {
      set({
        activeCatalog: {
          ...prev,
          photos: prev.photos.filter((p) => !idSet.has(p.id)),
        },
      });
    }

    try {
      await repo.deletePhotos(photoIds);
      // Reconcile with DB
      await get().loadCatalog(catalogId);
      await get().refreshCatalogs();
    } catch (e) {
      if (prev) set({ activeCatalog: prev });
      throw e;
    }
  },

  cropPhoto: async (photoId, catalogId, crop) => {
    const photo = await repo.getPhoto(photoId);
    if (!photo) throw new Error('Photo not found');

    const saved = await cropAndSaveImage(photo.uri, crop, { catalogId });
    await repo.updatePhotoUri(photoId, saved.relativePath, saved.width, saved.height);
    await get().loadCatalog(catalogId);
    await get().refreshCatalogs();
  },
}));
