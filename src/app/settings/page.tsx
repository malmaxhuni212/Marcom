import Sidebar from '@/components/layout/Sidebar';
import TopBar from '@/components/layout/TopBar';

export default function SettingsPage() {
  return (
    <div className="flex min-h-screen bg-[#08080c]">
      <Sidebar />
      <div className="flex-1 ml-[220px] flex flex-col">
        <TopBar />
        <main className="flex-1 px-10 py-6 flex items-center justify-center">
          <div className="text-center space-y-4">
            <div className="w-16 h-16 bg-white/[0.02] border border-white/[0.05] rounded-2xl mx-auto flex items-center justify-center">
              <svg className="w-6 h-6 text-white/20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
            </div>
            <h1 className="text-2xl font-semibold text-white/80">Settings</h1>
            <p className="text-white/40 max-w-sm">This module is under construction. It will be available in the next MARCOM release.</p>
          </div>
        </main>
      </div>
    </div>
  );
}