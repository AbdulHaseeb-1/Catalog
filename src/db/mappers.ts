import type { Catalog, CatalogListItem, LayoutId, Photo } from '@/types/models';

type CatalogRow = {
  id: string;
  title: string;
  layout_id: string;
  page_size: string;
  created_at: string;
  updated_at: string;
  photo_count?: number;
  cover_uri?: string | null;
};

type PhotoRow = {
  id: string;
  catalog_id: string;
  uri: string;
  sort_order: number;
  width: number | null;
  height: number | null;
  created_at: string;
};

export function mapCatalog(row: CatalogRow): Catalog {
  return {
    id: row.id,
    title: row.title,
    layoutId: (row.layout_id as LayoutId) || '2x2',
    pageSize: (row.page_size as Catalog['pageSize']) || 'A4',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapCatalogListItem(row: CatalogRow): CatalogListItem {
  return {
    ...mapCatalog(row),
    photoCount: row.photo_count ?? 0,
    coverUri: row.cover_uri ?? null,
  };
}

export function mapPhoto(row: PhotoRow): Photo {
  return {
    id: row.id,
    catalogId: row.catalog_id,
    uri: row.uri,
    sortOrder: row.sort_order,
    width: row.width,
    height: row.height,
    createdAt: row.created_at,
  };
}
