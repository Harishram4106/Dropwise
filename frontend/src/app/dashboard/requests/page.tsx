import type { Metadata } from "next";
import Requests from "@/components/dashboard/Requests";

export const metadata: Metadata = { title: "Requests · Dropwise" };

export default function RequestsPage() {
  return <Requests />;
}
