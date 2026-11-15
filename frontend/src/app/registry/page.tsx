import type { Metadata } from "next";
import RegistryPage from "@/components/dashboard/RegistryPage";

export const metadata: Metadata = {
  title: "Evidence registry · Dropwise",
  description: "Every factor behind a Dropwise water estimate: its value, source, date, freshness and signed version.",
};

export default function Page() {
  return <RegistryPage />;
}
