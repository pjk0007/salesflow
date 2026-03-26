import LandingNavbar from "./LandingNavbar";
import HeroSection from "./HeroSection";
import SocialProofSection from "./SocialProofSection";
import FeaturesSection from "./FeaturesSection";
import HowItWorksSection from "./HowItWorksSection";
import PricingSection from "./PricingSection";
import FaqSection from "./FaqSection";
import CtaSection from "./CtaSection";
import LandingFooter from "./LandingFooter";

export default function LandingPage() {
    return (
        <div className="min-h-screen flex flex-col scroll-smooth">
            <LandingNavbar />
            <main className="flex-1">
                <HeroSection />
                <SocialProofSection />
                <FeaturesSection />
                <HowItWorksSection />
                <PricingSection />
                <FaqSection />
                <CtaSection />
            </main>
            <LandingFooter />
        </div>
    );
}
