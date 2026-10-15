import Sidebar from '@/components/layout/Sidebar';
import TopBar from '@/components/layout/TopBar';
import HeroSection from '@/components/home/HeroSection';
import GetStartedSection from '@/components/home/GetStartedSection';
import ProjectsSection from '@/components/home/ProjectsSection';
import AgentActivitySection from '@/components/home/AgentActivitySection';

export default function HomePage() {
  return (
    <div className="flex min-h-screen bg-[#08080c]">
      <Sidebar />
      <div className="flex-1 ml-[220px] flex flex-col">
        <TopBar />
        <main className="flex-1 px-10 py-6 overflow-y-auto">
          <HeroSection />
          
          <div className="h-px bg-gradient-to-r from-transparent via-white/[0.06] to-transparent my-2" />
          
          <GetStartedSection />
          
          <div className="h-px bg-gradient-to-r from-transparent via-white/[0.06] to-transparent my-2" />
          
          <div className="grid grid-cols-12 gap-8">
            <div className="col-span-8">
              <ProjectsSection />
            </div>
            <div className="col-span-4">
              <AgentActivitySection />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
