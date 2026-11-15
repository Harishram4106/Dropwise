import type { Metadata } from "next";
import Benchmark from "@/components/dashboard/Benchmark";

export const metadata: Metadata = { title: "Before / after · Dropwise" };

export default function BenchmarkPage() {
  return <Benchmark />;
}
