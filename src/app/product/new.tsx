import { useLocalSearchParams, useRouter } from 'expo-router';

import { ProductForm } from '@/components/product-form';
import { useLibraryStore } from '@/stores/library-store';

function param(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default function NewProductScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ companyId?: string | string[]; formulaId?: string | string[] }>();
  const addProduct = useLibraryStore((s) => s.addProduct);

  return (
    <ProductForm
      mode="create"
      // Pre-filled when the user starts from a company or formula screen.
      initialCompanyId={param(params.companyId)}
      initialFormulaId={param(params.formulaId)}
      submitLabel="Add product"
      onSubmit={async ({ companyId, formulaId, sourceUri, crops, rotation, sourceSize }) => {
        if (!sourceUri) throw new Error('Add a photo of the pack.');
        await addProduct({ companyId, formulaId, sourceUri, crops, rotation, sourceSize });
        router.back();
      }}
    />
  );
}
