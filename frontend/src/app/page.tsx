import Cta from "@/components/Cta";
import Developers from "@/components/Developers";
import Faq from "@/components/Faq";
import Features from "@/components/Features";
import Gap from "@/components/Gap";
import Hero from "@/components/Hero";
import Honesty from "@/components/Honesty";
import HowItWorks from "@/components/HowItWorks";
import Levers from "@/components/Levers";
import LiveMeter from "@/components/LiveMeter";
import Nav from "@/components/Nav";
import ReceiptSection from "@/components/ReceiptSection";
import Registry from "@/components/Registry";
import Roadmap from "@/components/Roadmap";

export default function Home() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Features />
        <Gap />
        <ReceiptSection />
        <Levers />
        <LiveMeter />
        <Registry />
        <HowItWorks />
        <Developers />
        <Honesty />
        <Roadmap />
        <Faq />
        <Cta />
      </main>
    </>
  );
}
