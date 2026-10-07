import Sidebar from '@/components/layout/Sidebar';
import TopBar from '@/components/layout/TopBar';
import ProjectsSection from '@/components/home/ProjectsSection';

export default function ResearchPage() {
  return (
    <div className="flex min-h-screen bg-[#08080c]">
      <Sidebar />
      <div className="flex-1 ml-[220px] flex flex-col">
        <TopBar />
        <main className="flex-1 px-10 py-6 overflow-y-auto">
          <div className="mb-8 flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 flex items-center justify-center text-2xl">
              <svg className="w-6 h-6" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="8.5" cy="8.5" r="5.5" />
                <line x1="13" y1="13" x2="18" y2="18" />
              </svg>
            </div>
            <div>
              <h1 className="text-3xl font-semibold text-white/90">Research Central</h1>
              <p className="text-white/40 mt-1 max-w-2xl">
                Research is conducted on a per-project basis. Select a project below to open the Research Agent and view identified prospects.
              </p>
            </div>
          </div>
          
          <div className="p-6 bg-white/[0.02] border border-white/[0.05] rounded-2xl mb-8">
            <h2 className="text-lg font-medium text-white/80 mb-2">How it works</h2>
            <ul className="text-[13px] text-white/50 space-y-2 list-disc list-inside">
              <li>Open a project from the list below.</li>
              <li>Input a prospect name into the Research Agent on the right side of the project dashboard.</li>
              <li>The Research Agent will search the web, verify facts, evaluate fit, and extract contacts.</li>
              <li>Results will be saved as structured Research Records.</li>
            </ul>
          </div>

          <ProjectsSection />
        </main>
      </div>
    </div>
  );
}
