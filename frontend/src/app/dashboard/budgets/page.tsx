import type { Metadata } from "next";
import Budgets from "@/components/dashboard/Budgets";

export const metadata: Metadata = { title: "Budgets · Dropwise" };

export default function BudgetsPage() {
  return <Budgets />;
}
