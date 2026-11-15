import type { Metadata } from "next";
import { Suspense } from "react";
import { ConnectionProvider } from "@/components/dashboard/connection";

export const metadata: Metadata = {
  title: "Dashboard · Dropwise",
  description: "Live water estimates, savings and budgets for every request through the Dropwise gateway.",
};

// The dashboard reads ?scope and ?demo from the URL, so it renders on the client inside this boundary.
function Loading() {
  return <div className="min-h-screen bg-black" />;
}

export default function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  return (
    <Suspense fallback={<Loading />}>
      <ConnectionProvider>{children}</ConnectionProvider>
    </Suspense>
  );
}
