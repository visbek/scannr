import { SavedReport } from "@/components/scanner/SavedReport";

export const metadata = { title: "Saved report | Scanrr", robots: { index: false, follow: false } };

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SavedReport key={id} id={id} />;
}
