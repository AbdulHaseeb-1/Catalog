import { useLocalSearchParams } from 'expo-router';

import { ReferenceDetailScreen } from '@/components/reference-detail-screen';

export default function FormulaDetailScreen() {
  const params = useLocalSearchParams<{ formulaId?: string | string[] }>();
  const id = Array.isArray(params.formulaId) ? params.formulaId[0] : params.formulaId;

  return <ReferenceDetailScreen kind="formula" id={id} />;
}
