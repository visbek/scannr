import { notFound } from "next/navigation";
import { DemoReport } from "@/components/scanner/DemoReport";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sample report — Scanrr demo", robots: { index: false, follow: false } };

export default function DemoPage() {
  if (process.env.SCANRR_DEMO !== "1") notFound();
  return <DemoReport />;
}
