import type { Metadata } from "next";
import Routing from "@/components/dashboard/Routing";

export const metadata: Metadata = { title: "Routing & cache · Dropwise" };

export default function RoutingPage() {
  return <Routing />;
}
