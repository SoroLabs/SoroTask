'use client';

import { useParams } from 'next/navigation';
import { SharedAccessPage } from '@/components/SharedAccessPage';
import { useSharing } from '@/hooks/useSharing';

export default function SharedPage() {
  const params = useParams();
  const token = params.token as string;
  const { validateAccess } = useSharing();

  return <SharedAccessPage shareToken={token} onValidateAccess={validateAccess} />;
}
