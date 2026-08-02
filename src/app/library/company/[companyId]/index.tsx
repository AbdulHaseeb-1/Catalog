import { useLocalSearchParams } from 'expo-router';

import { ReferenceDetailScreen } from '@/components/reference-detail-screen';

export default function CompanyDetailScreen() {
  const params = useLocalSearchParams<{ companyId?: string | string[] }>();
  const id = Array.isArray(params.companyId) ? params.companyId[0] : params.companyId;

  return <ReferenceDetailScreen kind="company" id={id} />;
}
