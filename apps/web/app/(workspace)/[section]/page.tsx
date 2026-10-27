import { notFound } from 'next/navigation';
import Workspace from '@/components/workspace';

const sections = ['dashboard', 'patients', 'requests', 'specimens', 'results', 'reports', 'catalogue', 'predictions', 'users', 'audit-logs'];

export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!sections.includes(section)) notFound();
  return <Workspace section={section} />;
}
