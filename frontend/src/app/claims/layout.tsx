import { Suspense } from "react";
import { ConnectionProvider } from "@/components/dashboard/connection";

// Public pages share the dashboard's connection logic (live gateway or saved demo data) and its ?scope / ?demo params.
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-black" />}>
      <ConnectionProvider>{children}</ConnectionProvider>
    </Suspense>
  );
}
