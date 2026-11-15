import type { Metadata } from "next";
import Claims from "@/components/dashboard/Claims";

export const metadata: Metadata = {
  title: "Claim checker · Dropwise",
  description: "Paste a claim about AI and water; Dropwise splits it up and checks each part against sourced figures.",
};

export default function ClaimsPage() {
  return <Claims />;
}
