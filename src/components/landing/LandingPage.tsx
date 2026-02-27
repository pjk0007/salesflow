import LandingNavbar from "./LandingNavbar";
import HeroSection from "./HeroSection";
import SocialProofSection from "./SocialProofSection";
import ProductPreviewSection from "./ProductPreviewSection";
import HowItWorksSection from "./HowItWorksSection";
import FeaturesSection from "./FeaturesSection";
import PricingSection from "./PricingSection";
import FaqSection from "./FaqSection";
import CtaSection from "./CtaSection";
import LandingFooter from "./LandingFooter";

export default function LandingPage() {
    return (
        <div className="min-h-screen flex flex-col">
            <LandingNavbar />
            <main className="flex-1">
                <HeroSection />
                <SocialProofSection />
                <ProductPreviewSection />
                <HowItWorksSection />
                <FeaturesSection />
                <PricingSection />
                <FaqSection />
                <CtaSection />
            </main>
            <LandingFooter />
        </div>
    );
}
