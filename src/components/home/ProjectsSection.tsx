'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import BriefIntakeModal from '@/components/ui/BriefIntakeModal';
import type { Project } from '@/types';
import { authenticatedFetch } from '@/auth/client';


interface ProjectCardProps {
  project: Project;
  onDelete: (id: string, e: React.MouseEvent) => void;
  isDeleting?: boolean;
}

function ProjectIcon({ icon, color }: { icon: string; color: Project['accentColor'] }) {
  const colorMap = {
    blue: 'bg-blue-500/10 border-blue-500/20 text-blue-400',
    pink: 'bg-pink-500/10 border-pink-500/20 text-pink-400',
    purple: 'bg-purple-500/10 border-purple-500/20 text-purple-400',
    amber: 'bg-amber-500/10 border-amber-500/20 text-amber-400',
  };

  return (
    <div className={`w-10 h-10 rounded-xl border flex items-center justify-center text-lg flex-shrink-0 ${colorMap[color] || colorMap.blue}`}>
      {icon}
    </div>
  );
}

export function ProjectCard({ project, onDelete, isDeleting }: ProjectCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <Link 
      href={`/projects/${project.id}`} 
      className="block group relative backdrop-blur-xl bg-white/[0.03] border border-white/[0.07] rounded-2xl p-5 transition-all duration-300 hover:bg-white/[0.05] hover:border-cyan-500/30 hover:shadow-[0_8px_30px_rgba(0,0,0,0.45)] hover:-translate-y-0.5 flex flex-col justify-between"
    >
      {/* Top Header */}
      <div>
        <div className="flex items-start justify-between gap-2.5 mb-3.5">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <ProjectIcon icon={project.icon} color={project.accentColor} />
            <div className="min-w-0 flex-1">
              <h4 className="text-[15px] font-semibold text-white/90 truncate group-hover:text-cyan-300 transition-colors" title={project.name}>
                {project.name}
              </h4>
              <p className="text-[11px] text-white/40 tracking-wide mt-0.5">MARCOM Campaign</p>
            </div>
          </div>
          
          {/* Discreet Remove Action */}
          <div className="relative shrink-0">
            {confirmDelete ? (
              <div 
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onDelete(project.id, e);
                }}
                className="flex items-center gap-1 bg-red-500/20 border border-red-500/40 text-red-400 rounded-lg px-2 py-0.5 text-[11px] font-medium hover:bg-red-500/30 cursor-pointer transition-all animate-fadeIn"
                title="Click again to permanently delete"
              >
                Delete?
              </div>
            ) : (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setConfirmDelete(true);
                  setTimeout(() => setConfirmDelete(false), 3000);
                }}
                disabled={isDeleting}
                className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-white/20 hover:text-red-400 hover:bg-white/[0.04] transition-all cursor-pointer"
                title="Remove project"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M2.5 4h11M5.5 4V2.5a1 1 0 011-1h3a1 1 0 011 1V4M6 7.5v4.5M10 7.5v4.5M4 4l.8 9.2a1.5 1.5 0 001.5 1.3h3.4a1.5 1.5 0 001.5-1.3L12 4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Description */}
        <p className="text-[12.5px] text-white/50 leading-relaxed line-clamp-3 mb-4 min-h-[54px]">
          {project.description}
        </p>

        {/* Clean 2-Column Stats: Total and Personalized */}
        <div className="grid grid-cols-2 gap-3 bg-white/[0.02] border border-white/[0.05] rounded-xl p-3.5 mb-4">
          <div>
            <p className="text-[10px] text-white/35 uppercase font-medium tracking-wider mb-1">Total</p>
            <p className="text-base font-semibold text-white/90">{project.prospectsCurrent}</p>
          </div>
          <div>
            <p className="text-[10px] text-purple-300/70 uppercase font-medium tracking-wider mb-1">Personalized</p>
            <p className="text-base font-semibold text-purple-300">{project.qualifiedCount}</p>
          </div>
        </div>
      </div>

      {/* Clean Bottom Action */}
      <div className="pt-3 border-t border-white/[0.06] flex items-center justify-between text-xs font-medium text-white/50 group-hover:text-cyan-400 transition-colors">
        <span>Open Project Dashboard</span>
        <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
          <path d="M6 3.5l4.5 4.5-4.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </Link>
  );
}

function NewProjectCard({ onClick }: { onClick: () => void }) {
  return (
    <div 
      onClick={onClick} 
      className="group relative backdrop-blur-xl bg-white/[0.02] border border-dashed border-white/[0.09] rounded-2xl p-5 transition-all duration-300 hover:bg-white/[0.04] hover:border-cyan-500/30 hover:shadow-[0_0_25px_rgba(34,211,238,0.06)] hover:-translate-y-0.5 cursor-pointer flex flex-col items-center justify-center min-h-[280px]"
    >
      <div className="w-11 h-11 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center mb-3 group-hover:bg-cyan-500/10 group-hover:border-cyan-500/20 group-hover:scale-105 transition-all">
        <svg className="w-5 h-5 text-white/40 group-hover:text-cyan-400 transition-colors" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M10 4v12M4 10h12" />
        </svg>
      </div>
      <h4 className="text-[14px] font-semibold text-white/80 group-hover:text-white mb-1 transition-colors">New Project</h4>
      <p className="text-[11px] text-white/35 text-center leading-relaxed">
        Paste a brief or upload a document<br />to start with MARCOM.
      </p>
    </div>
  );
}

export default function ProjectsSection() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadProjects = async () => {
    try {
      const res = await authenticatedFetch('/api/projects');
      if (res.ok) {
        const data = await res.json();
        setProjects(data);
      }
    } catch (e) {
      console.error('Error fetching projects:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProjects();
  }, []);

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      setDeletingId(id);
      // Optimistic update
      setProjects((prev) => prev.filter((p) => p.id !== id));

      const res = await authenticatedFetch(`/api/projects?id=${id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        // Rollback on error
        await loadProjects();
      }
    } catch (err) {
      console.error('Failed to delete project:', err);
      await loadProjects();
    } finally {
      setDeletingId(null);
    }
  };

  // Non-blocking loading: Always show the section and New Project card, show skeletons if loading

  return (
    <section className="py-6">
      <div className="flex items-end justify-between mb-6">
        <div>
          <h3 className="text-[20px] font-semibold text-white/90">Your projects</h3>
          <p className="text-[13px] text-white/40 mt-1">
            {projects.length === 0 ? "You don't have any projects yet." : "Manage and track all your outreach projects."}
          </p>
        </div>
        {projects.length > 0 && (
          <button className="flex items-center gap-1.5 text-[13px] text-white/40 hover:text-white/60 transition-colors group">
            View all ({projects.length})
            <svg className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M5 3l5 4-5 4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {loading ? (
          <div className="backdrop-blur-xl bg-white/[0.02] border border-white/[0.05] rounded-2xl p-5 min-h-[280px] animate-pulse flex flex-col justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/[0.05]" />
              <div className="space-y-1.5 flex-1">
                <div className="h-3.5 bg-white/[0.05] rounded w-2/3" />
                <div className="h-2.5 bg-white/[0.03] rounded w-1/3" />
              </div>
            </div>
            <div className="h-10 bg-white/[0.02] rounded-xl" />
            <div className="h-2 bg-white/[0.05] rounded w-full" />
          </div>
        ) : (
          projects.map((project: Project) => (
            <ProjectCard 
              key={project.id} 
              project={project} 
              onDelete={handleDelete}
              isDeleting={deletingId === project.id}
            />
          ))
        )}
        <NewProjectCard onClick={() => setIsModalOpen(true)} />
      </div>
      
      <BriefIntakeModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        onSuccess={() => loadProjects()} 
      />
    </section>
  );
}
