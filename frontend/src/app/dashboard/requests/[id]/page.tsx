import type { Metadata } from "next";
import Receipt from "@/components/dashboard/Receipt";

export const metadata: Metadata = { title: "Receipt · Dropwise" };

// The id is read on the client (useParams) inside the dashboard layout's Suspense boundary.
export default function ReceiptPage() {
  return <Receipt />;
}
