import Sidebar from '@/components/layout/Sidebar';
import TopBar from '@/components/layout/TopBar';
import ProjectsSection from '@/components/home/ProjectsSection';

export default function ProjectsPage() {
  return (
    <div className="flex min-h-screen bg-[#08080c]">
      <Sidebar />
      <div className="flex-1 ml-[220px] flex flex-col">
        <TopBar />
        <main className="flex-1 px-10 py-6 overflow-y-auto">
          <div className="mb-8">
            <h1 className="text-3xl font-semibold text-white/90">All Projects</h1>
            <p className="text-white/40 mt-2">Manage your MARCOM campaigns.</p>
          </div>
          <ProjectsSection />
        </main>
      </div>
    </div>
  );
}
