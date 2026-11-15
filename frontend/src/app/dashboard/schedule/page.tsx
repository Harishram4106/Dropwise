import type { Metadata } from "next";
import Schedule from "@/components/dashboard/Schedule";

export const metadata: Metadata = { title: "Time shifting · Dropwise" };

export default function SchedulePage() {
  return <Schedule />;
}
